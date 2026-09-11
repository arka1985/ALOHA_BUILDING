// Initialize map
const map = L.map('map').setView([20.5937, 78.9629], 5); // Default to India

// Add dark mode tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

// Load India States
fetch('INDIA/INDIA_STATES.geojson')
    .then(response => response.json())
    .then(data => {
        L.geoJSON(data, {
            style: {
                color: '#333333',
                weight: 1,
                dashArray: '2, 5',
                fillOpacity: 0,
                opacity: 0.7
            }
        }).addTo(map);
    })
    .catch(err => console.error('Error loading India states:', err));

// State
let threatZonesLayer = null;
let buildingsLayer = null;
let threatZonesGeoJSON = null;

// DOM Elements
const fileInput = document.getElementById('kml-upload');
const uploadText = document.getElementById('upload-text');
const loadingIndicator = document.getElementById('loading-indicator');
const loadingText = document.getElementById('loading-text');
const statusMessage = document.getElementById('status-message');
const countRed = document.getElementById('count-red');
const countOrange = document.getElementById('count-orange');
const countYellow = document.getElementById('count-yellow');

// Event Listeners
fileInput.addEventListener('change', handleFileUpload);

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadText.textContent = file.name;
    statusMessage.textContent = '';
    showLoading(true, 'Parsing KML...');

    const reader = new FileReader();
    reader.onload = function (e) {
        const kmlText = e.target.result;
        processKML(kmlText);
    };
    reader.readAsText(file);
}

function processKML(kmlText) {
    try {
        const parser = new DOMParser();
        const kmlDom = parser.parseFromString(kmlText, 'text/xml');
        const geojson = toGeoJSON.kml(kmlDom);

        if (!geojson.features || geojson.features.length === 0) {
            throw new Error('No valid features found in KML.');
        }

        threatZonesGeoJSON = geojson;

        // Clear existing layers
        if (threatZonesLayer) map.removeLayer(threatZonesLayer);
        if (buildingsLayer) map.removeLayer(buildingsLayer);

        updateCounts(0, 0, 0);

        // Add to map
        threatZonesLayer = L.geoJSON(geojson, {
            style: function (feature) {
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

        const bounds = threatZonesLayer.getBounds();
        map.fitBounds(bounds);

        fetchBuildings(bounds);

    } catch (error) {
        console.error(error);
        statusMessage.textContent = 'Error parsing KML: ' + error.message;
        showLoading(false);
    }
}

async function fetchBuildings(bounds) {
    showLoading(true, 'Fetching OSM data...');

    const south = bounds.getSouth();
    const west = bounds.getWest();
    const north = bounds.getNorth();
    const east = bounds.getEast();

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
            body: query
        });

        if (!response.ok) throw new Error('Overpass API request failed');

        const osmData = await response.json();
        const buildingsGeoJSON = osmtogeojson(osmData);

        // Display buildings
        buildingsLayer = L.geoJSON(buildingsGeoJSON, {
            style: {
                color: '#000000',
                weight: 2,
                fillColor: '#2563eb',
                fillOpacity: 0.8
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
    showLoading(true, 'Analyzing impact...');

    // Use setTimeout to allow UI to update before heavy calculation
    setTimeout(() => {
        let redCount = 0;
        let orangeCount = 0;
        let yellowCount = 0;

        const zones = { red: null, orange: null, yellow: null };

        threatZonesGeoJSON.features.forEach(feature => {
            const name = feature.properties.name ? feature.properties.name.toLowerCase() : '';
            const styleUrl = feature.properties.styleUrl || '';

            if (name.includes('red') || styleUrl.includes('red')) zones.red = feature;
            else if (name.includes('orange') || styleUrl.includes('orange')) zones.orange = feature;
            else if (name.includes('yellow') || styleUrl.includes('yellow')) zones.yellow = feature;
        });

        buildings.features.forEach(building => {
            // Calculate overlap area
            const buildingPoly = building.geometry.type === 'Polygon' ? turf.polygon(building.geometry.coordinates) :
                building.geometry.type === 'MultiPolygon' ? turf.multiPolygon(building.geometry.coordinates) : null;

            if (!buildingPoly) return;

            const buildingArea = turf.area(buildingPoly);
            let assigned = false;

            // Check Red
            if (zones.red && !assigned) {
                try {
                    const intersection = turf.intersect(buildingPoly, zones.red);
                    if (intersection) {
                        const overlapArea = turf.area(intersection);
                        if (overlapArea / buildingArea > 0.5) {
                            redCount++;
                            assigned = true;
                        }
                    }
                } catch (e) { }
            }

            // Check Orange
            if (zones.orange && !assigned) {
                try {
                    const intersection = turf.intersect(buildingPoly, zones.orange);
                    if (intersection) {
                        const overlapArea = turf.area(intersection);
                        if (overlapArea / buildingArea > 0.5) {
                            orangeCount++;
                            assigned = true;
                        }
                    }
                } catch (e) { }
            }

            // Check Yellow
            if (zones.yellow && !assigned) {
                try {
                    const intersection = turf.intersect(buildingPoly, zones.yellow);
                    if (intersection) {
                        const overlapArea = turf.area(intersection);
                        if (overlapArea / buildingArea > 0.5) {
                            yellowCount++;
                            assigned = true;
                        }
                    }
                } catch (e) { }
            }
        });

        updateCounts(redCount, orangeCount, yellowCount);
        showLoading(false);
    }, 100);
}

function updateCounts(r, o, y) {
    countRed.textContent = r;
    countOrange.textContent = o;
    countYellow.textContent = y;
}

function showLoading(show, text = 'Loading...') {
    if (show) {
        loadingIndicator.classList.remove('hidden');
        loadingText.textContent = text;
    } else {
        loadingIndicator.classList.add('hidden');
    }
}
