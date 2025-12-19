# ALOHA Threat Zone Analyzer

A web-based tool to analyze threat zones from KML files and count affected buildings using OpenStreetMap data.

## Features

-   **KML Upload**: Upload `.kml` files containing threat zone polygons (Red, Orange, Yellow).
-   **Building Count**: Automatically counts buildings within each threat zone using OSM data.
-   **Interactive Map**: Visualizes threat zones and buildings on a dark-themed Leaflet map.
-   **India Map Support**: Includes a detailed map of India states.
-   **Flashing Indicators**: Visual alerts for active threat zones.
-   **Privacy Focused**: Runs entirely in the browser (Client-Side version) or locally.

## How to Use

### Option 1: Client-Side (Recommended)

This version runs directly in your web browser without needing a backend server.

1.  Navigate to the `docs` folder.
2.  Open `index.html` in your web browser (Chrome, Firefox, Edge).
3.  Click the **"Upload KML File"** button.
4.  Select your `.kml` file containing the threat zones.
    -   *Note: The KML should have polygons named or styled with "red", "orange", or "yellow" to be recognized.*
5.  The application will:
    -   Parse the KML.
    -   Display the zones on the map.
    -   Fetch building data from OpenStreetMap.
    -   Calculate and display the number of buildings in each zone.

### Option 2: Python Server (Development)

If you want to run the Python backend version (if applicable):

1.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
2.  Run the server:
    ```bash
    python app.py
    ```
3.  Open `http://localhost:5000` in your browser.

## Project Structure

-   `docs/`: Contains the client-side application (GitHub Pages ready).
    -   `index.html`: Main application file.
    -   `INDIA/`: Contains map data for India.
-   `app.py`: Python Flask backend (optional).
-   `templates/` & `static/`: Backend assets.

## Credits

Developed by **Dr. Arkaprabha Sau**
MBBS, MD (Gold Medalist), DPH, PhD (CSE-AI-ML)
