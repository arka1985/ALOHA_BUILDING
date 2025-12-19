# How to Start the ALOHA Threat Zone Analyzer

Follow these steps to set up and run the application.

## Prerequisites
- **Python 3.x** installed on your system.
- An internet connection (for fetching OpenStreetMap data).

## Installation

1.  Open a terminal or command prompt in this folder (`c:\Users\arka\ALOHA_BUILDING`).
2.  Install the required Python libraries:
    ```bash
    pip install -r requirements.txt
    ```

## Running the Application

1.  Start the Flask server:
    ```bash
    python app.py
    ```
2.  You should see output indicating the server is running (usually `Running on http://0.0.0.0:5000`).

## Using the App

1.  Open your web browser and go to:
    [http://localhost:5000](http://localhost:5000)
2.  Click the **Upload KML File** button.
3.  Select your ALOHA `.kml` file.
4.  Wait for the analysis to complete. The map will display the threat zones, buildings, and India's state borders, and the panel on the right will show the building counts.

## Troubleshooting
- **Map not loading?** Check your internet connection.
- **"Address already in use"?** Make sure no other application is using port 5000.
