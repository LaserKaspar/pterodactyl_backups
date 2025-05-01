# Pterodactyl Backups

## Backups all Servers on Nodes that are connected to a Panel instance.

## Setup

Use makefile to generate a build of the dockerfile.

> make

Load it into the server

> docker load < ./pterodactyl-backups-latest.tar.gz

Run it

> docker run --env-file .env -v "./syncs:/app/syncs" pterodactyl-backups:latest