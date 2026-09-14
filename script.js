// Initialize map
const map = L.map('map').setView([20.5937, 78.9629], 5); // Default to India

// Add OpenStreetMap with a CSS filter to create a perfect Dark Mode (No API key needed!)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'map-tiles'
}).addTo(map);

// State
let threatZonesLayer = null;
let buildingsLayer = null;
let threatZonesGeoJSON = null;

// DOM Elements
const fileInput = document.getElementById('kml-upload');
const fileNameDisplay = document.getElementById('file-name');
const loadingIndicator = document.getElementById('loading-indicator');
const statusMessage = document.getElementById('status-message');
const countRed = document.getElementById('count-red');
const countOrange = document.getElementById('count-orange');
const countYellow = document.getElementById('count-yellow');

// Event Listeners
fileInput.addEventListener('change', handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    fileNameDisplay.textContent = file.name;
    statusMessage.textContent = '';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const kmlText = e.target.result;
        processKML(kmlText);
    };
    reader.readAsText(file);
}

function processKML(kmlText) {
    try {
        // Parse KML to XML
        const parser = new DOMParser();
        const kmlDom = parser.parseFromString(kmlText, 'text/xml');
        
        // Convert to GeoJSON
        const geojson = toGeoJSON.kml(kmlDom);
        
        if (!geojson.features || geojson.features.length === 0) {
            throw new Error('No valid features found in KML.');
        }

        threatZonesGeoJSON = geojson;
        
        // Clear existing layers
        if (threatZonesLayer) map.removeLayer(threatZonesLayer);
        if (buildingsLayer) map.removeLayer(buildingsLayer);
        
        // Reset counts
        updateCounts(0, 0, 0);

        // Add to map
        threatZonesLayer = L.geoJSON(geojson, {
            style: function(feature) {
                // Try to detect color from KML properties or default based on order/name
                // ALOHA usually exports Red, Orange, Yellow zones
                let color = '#3388ff';
                const name = feature.properties.name ? feature.properties.name.toLowerCase() : '';
                const styleUrl = feature.properties.styleUrl || '';
                
                if (name.includes('red') || styleUrl.includes('red')) color = '#ef4444';
                else if (name.includes('orange') || styleUrl.includes('orange')) color = '#f97316';
                else if (name.includes('yellow') || styleUrl.includes('yellow')) color = '#eab308';
                
                return {
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.3,
                    weight: 2
                };
            }
        }).addTo(map);

        // Zoom to bounds
        const bounds = threatZonesLayer.getBounds();
        map.fitBounds(bounds);

        // Fetch buildings
        fetchBuildings(bounds);

    } catch (error) {
        console.error(error);
        statusMessage.textContent = 'Error parsing KML: ' + error.message;
    }
}

async function fetchBuildings(bounds) {
    showLoading(true);
    statusMessage.textContent = 'Fetching building data from OpenStreetMap...';

    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

    // Overpass API query
    const query = `
        [out:json][timeout:25];
        (
          way["building"](${south},${west},${north},${east});
          relation["building"](${south},${west},${north},${east});
        );
        out body;
        >;
        out skel qt;
    `;

    try {
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(query)
        });

        if (!response.ok) throw new Error('Overpass API request failed');

        const osmData = await response.json();
        const buildingsGeoJSON = osmtogeojson(osmData);

        // Display buildings (optional, maybe just for debug or visual confirmation)
        buildingsLayer = L.geoJSON(buildingsGeoJSON, {
            style: {
                color: '#666',
                weight: 1,
                fillColor: '#999',
                fillOpacity: 0.5
            }
        }).addTo(map);

        analyzeImpact(buildingsGeoJSON);

    } catch (error) {
        console.error(error);
        statusMessage.textContent = 'Error fetching buildings: ' + error.message;
        showLoading(false);
    }
}

function analyzeImpact(buildings) {
    statusMessage.textContent = 'Analyzing impact...';
    
    let redCount = 0;
    let orangeCount = 0;
    let yellowCount = 0;

    // Identify zones from threatZonesGeoJSON
    // Assuming 3 polygons for Red, Orange, Yellow. 
    // We need to identify which is which.
    
    const zones = {
        red: null,
        orange: null,
        yellow: null
    };

    threatZonesGeoJSON.features.forEach(feature => {
        const name = feature.properties.name ? feature.properties.name.toLowerCase() : '';
        const styleUrl = feature.properties.styleUrl || '';
        
        // Simple heuristic for ALOHA KMLs
        if (name.includes('red') || styleUrl.includes('red')) zones.red = feature;
        else if (name.includes('orange') || styleUrl.includes('orange')) zones.orange = feature;
        else if (name.includes('yellow') || styleUrl.includes('yellow')) zones.yellow = feature;
    });

    // If heuristics fail, maybe sort by area? (Red is usually smallest, Yellow largest)
    // For now, let's rely on name/style.

    buildings.features.forEach(building => {
        // Use centroid for point-in-polygon check
        const center = turf.centroid(building);
        
        if (zones.red && turf.booleanPointInPolygon(center, zones.red)) {
            redCount++;
            // If a building is in red, it's also in orange/yellow usually in ALOHA, but we want exclusive counts?
            // Usually we want "worst case" zone. So if in Red, don't count for Orange.
        } else if (zones.orange && turf.booleanPointInPolygon(center, zones.orange)) {
            orangeCount++;
        } else if (zones.yellow && turf.booleanPointInPolygon(center, zones.yellow)) {
            yellowCount++;
        }
    });

    updateCounts(redCount, orangeCount, yellowCount);
    statusMessage.textContent = 'Analysis complete.';
    showLoading(false);
}

function updateCounts(r, o, y) {
    // Animate numbers?
    countRed.textContent = r;
    countOrange.textContent = o;
    countYellow.textContent = y;
}

function showLoading(show) {
    if (show) loadingIndicator.classList.remove('hidden');
    else loadingIndicator.classList.add('hidden');
}
