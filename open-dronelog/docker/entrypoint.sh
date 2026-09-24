#!/bin/sh
set -e

# Start the Axum backend in the background
echo "Starting Open DroneLog API server on port 3001..."
/app/open-dronelog &

# Start nginx in the foreground
echo "Starting nginx on port 80..."
exec nginx -g 'daemon off;'
