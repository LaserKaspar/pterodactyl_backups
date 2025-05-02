#!/bin/sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="pterodactyl-backups:latest-<arch>"
IMAGE_TAR="$SCRIPT_DIR/pterodactyl-backups-latest-<arch>.tar.gz"

# Check if the image exists
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Docker image $IMAGE_NAME not found. Attempting to load from $IMAGE_TAR..."
  if [ -f "$IMAGE_TAR" ]; then
    docker load < "$IMAGE_TAR" || {
      echo "Failed to load Docker image from $IMAGE_TAR"
      exit 1
    }
  else
    echo "Image tarball $IMAGE_TAR not found."
    exit 1
  fi
fi

# Run the container from the script's directory
docker run \
  --env-file "$SCRIPT_DIR/.env" \
  -v "$SCRIPT_DIR/syncs:/app/syncs" \
  "$IMAGE_NAME"