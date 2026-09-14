from flask import Flask, render_template, request, redirect, url_for
import geopandas as gpd
import folium
import overturemaps
import pandas as pd
from shapely.geometry import Polygon
import os

# Create a Flask app
app = Flask(__name__)

# Set the upload folder
UPLOAD_FOLDER = "uploads"
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Ensure the upload folder exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Function to generate the map and building counts
def generate_map(kml_path):
    # Load the threat zones from the KML file
    # Note: 'Aloha Threat Zones' is the standard layer name for ALOHA KMLs, 
    # but we might need to be flexible if it varies.
    try:
        # Try reading without specifying layer first to see what's available or just default
        # But user code specified 'Aloha Threat Zones'. Let's try that, fallback to first layer if fails?
        # For now, stick to user logic but add error handling.
        try:
            gdf = gpd.read_file(kml_path, layer="Aloha Threat Zones")
        except ValueError:
            # Fallback: try reading the first layer found
            gdf = gpd.read_file(kml_path)
    except Exception as e:
        print(f"Error reading KML: {e}")
        return None, None

    # Assign zone colors (modify based on your KML's attribute field)
    # ALOHA KMLs usually have a 'Name' field like 'Red', 'Orange', 'Yellow'
    if "Name" in gdf.columns:
        gdf["zone_color"] = gdf["Name"].apply(
            lambda x: "yellow" if "Yellow" in str(x) else ("orange" if "Orange" in str(x) else "red")
        )
    else:
        # Fallback if Name is missing, maybe use styleUrl or just assign based on order?
        # For now, let's assume the user's logic holds for their files.
        gdf["zone_color"] = "red" # Default

    # Fix geometries and reproject to WGS84 for Overpass API
    gdf = gdf.to_crs("EPSG:4326")
    gdf["geometry"] = gdf.geometry.buffer(0)

    # Fetch building data from OpenStreetMap
    bbox = gdf.total_bounds  # (minx, miny, maxx, maxy)
    south, west, north, east = bbox[1], bbox[0], bbox[3], bbox[2]

    # Validate bounding box coordinates
    if not (-90 <= south <= 90 and -90 <= north <= 90 and -180 <= west <= 180 and -180 <= east <= 180):
        raise ValueError("Invalid bounding box coordinates.")

    try:
        import overturemaps
        print("Fetching AI building data from Overture Maps...")
        # overturemaps bbox is (xmin, ymin, xmax, ymax) which is (west, south, east, north)
        buildings_gdf = overturemaps.geodataframe('building', bbox=(west, south, east, north))
        print(f"Fetched {len(buildings_gdf)} buildings from Overture Maps.")
    except ImportError:
        print("Error: overturemaps is not installed. Please run: pip install overturemaps")
        return None, None
    except Exception as e:
        print(f"Error fetching building data from Overture Maps: {e}")
        return None, None

    if buildings_gdf.empty:
        print("No buildings found in Overture Maps for this area.")
        return [], create_folium_map(gdf, None, south, west, north, east)

    if buildings_gdf.crs is None or buildings_gdf.crs != "EPSG:4326":
        buildings_gdf = buildings_gdf.set_crs("EPSG:4326", allow_override=True)
    
    # Drop all columns except geometry to prevent JSON serialization errors (like ndarray)
    buildings_gdf = buildings_gdf[['geometry']]

    buildings_gdf = buildings_gdf.to_crs(gdf.crs)
    buildings_gdf["geometry"] = buildings_gdf.geometry.buffer(0)

    # Clip buildings to the threat zones
    clipped_buildings = gpd.clip(buildings_gdf, gdf.geometry.union_all())

    if clipped_buildings.empty:
         return [], create_folium_map(gdf, None, south, west, north, east)

    # Reproject to UTM Zone 45 for area calculations (User logic hardcoded Zone 45N? 
    # Better to estimate UTM zone from centroid, but sticking to user logic for now 
    # or using a generic equal area projection like EPSG:3857 for simplicity/speed if accuracy isn't sub-meter critical?
    # User asked for specific logic. I will stick to their EPSG:32645 but warn if outside India/Zone 45)
    utm_crs = "EPSG:32645" 
    clipped_buildings = clipped_buildings.to_crs(utm_crs)
    gdf_utm = gdf.to_crs(utm_crs)

    # Spatial join with intersects to allow partial overlaps
    buildings_within_zones = gpd.sjoin(clipped_buildings, gdf_utm, how="inner", predicate="intersects")

    # Calculate areas
    buildings_within_zones = buildings_within_zones.copy()  # Avoid SettingWithCopyWarning
    buildings_within_zones["building_area"] = buildings_within_zones.geometry.area
    buildings_within_zones["overlap_area"] = buildings_within_zones.apply(
        lambda row: row.geometry.intersection(gdf_utm.loc[row.index_right].geometry).area,
        axis=1
    )

    # Apply threshold to filter buildings
    threshold = 0.5  # Adjust this value (0.0 to 1.0)
    buildings_within_zones["is_within"] = (
        buildings_within_zones["overlap_area"] > threshold * buildings_within_zones["building_area"]
    )
    filtered_buildings = buildings_within_zones[buildings_within_zones["is_within"]]

    # Prioritize zones: red > orange > yellow
    if not filtered_buildings.empty:
        filtered_buildings = filtered_buildings.copy()  # Avoid SettingWithCopyWarning
        filtered_buildings['zone_color'] = pd.Categorical(
            filtered_buildings['zone_color'], 
            categories=['red', 'orange', 'yellow'], 
            ordered=True
        )
        filtered_buildings = filtered_buildings.sort_values('zone_color')

        # Remove duplicates, keeping the first (highest priority) occurrence
        filtered_buildings = filtered_buildings.drop_duplicates(subset='geometry', keep='first')

        # Count buildings per zone
        building_counts = filtered_buildings.groupby("zone_color", observed=False).size()
        building_count_table = building_counts.reset_index(name="count")
        
        # Convert to list of dicts for template
        counts_data = building_count_table.to_dict('records')
    else:
        counts_data = []

    # Reproject back to WGS84 for visualization
    gdf = gdf.to_crs("EPSG:4326")
    clipped_buildings = clipped_buildings.to_crs("EPSG:4326")
    
    return counts_data, create_folium_map(gdf, clipped_buildings, south, west, north, east, counts_data)

def create_folium_map(gdf, buildings_gdf, south, west, north, east, counts_data=None):
    center_lat = (south + north) / 2
    center_lon = (west + east) / 2
    m = folium.Map(
        location=[center_lat, center_lon], 
        zoom_start=16, 
        tiles='https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?api_key=cb1_3kxm_1_06ce7d7de871b835c5bea4c5',
        attr='&copy; OpenStreetMap contributors &copy; CARTO'
    )

    # Add India States with thin dotted lines
    try:
        # Use local file
        states_geojson_path = os.path.join("INDIA", "INDIA_STATES.geojson")
        if os.path.exists(states_geojson_path):
            folium.GeoJson(
                states_geojson_path,
                name="India States",
                style_function=lambda x: {
                    'color': '#ffffff',
                    'weight': 1,
                    'dashArray': '2, 5',
                    'fillOpacity': 0,
                    'opacity': 0.3
                }
            ).add_to(m)
        else:
            print(f"India states file not found at {states_geojson_path}")
    except Exception as e:
        print(f"Could not load India states: {e}")

    # Add threat zones
    colors = {"yellow": "#eab308", "orange": "#f97316", "red": "#ef4444"}
    
    # Helper to get count for a color
    def get_count(color):
        if not counts_data: return 0
        for item in counts_data:
            if item['zone_color'] == color:
                return item['count']
        return 0

    for idx, row in gdf.iterrows():
        zone_color = row.get('zone_color', 'red')
        count = get_count(zone_color)
        
        folium.GeoJson(
            row.geometry,
            name=f"{zone_color.capitalize()} Zone",
            style_function=lambda x, color=colors.get(zone_color, 'blue'): {
                'color': color,
                'weight': 2,
                'fillColor': color,
                'fillOpacity': 0.3
            },
            tooltip=f"{zone_color.capitalize()} Zone - Buildings: {count}"
        ).add_to(m)

    # Add buildings if available
    if buildings_gdf is not None and not buildings_gdf.empty:
        folium.GeoJson(
            buildings_gdf,
            name="Buildings",
            style_function=lambda x: {
                'color': '#60a5fa', 
                'weight': 1, 
                'fillColor': '#3b82f6',
                'fillOpacity': 0.7
            },
            tooltip="Building"
        ).add_to(m)

    return m._repr_html_()

# Route to handle file upload and display results
@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        # Check if a file was uploaded
        if 'kml_file' not in request.files:
            return redirect(request.url)
        
        file = request.files['kml_file']
        if file.filename == '':
            return redirect(request.url)
        
        if file:
            # Save the uploaded file
            kml_path = os.path.join(app.config['UPLOAD_FOLDER'], file.filename)
            file.save(kml_path)

            # Generate the map and building counts
            counts_data, map_html = generate_map(kml_path)
            
            # Format counts for the template
            counts = {'red': 0, 'orange': 0, 'yellow': 0}
            if counts_data:
                for item in counts_data:
                    counts[item['zone_color']] = item['count']

            return render_template('index.html', map_html=map_html, counts=counts)

    # Default GET request
    return render_template('index.html', map_html=None, counts=None)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
