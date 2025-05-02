# Pterodactyl Backups

## Backups all Servers on Nodes that are connected to a Panel instance.

## Setup

Use makefile to generate a build of the dockerfile.

> make

Copy ./pull-backups.sh and the newly created ./pterodactyl-backups-latest-<arch>.tar.gz to the backupserver.

> create .env file.

Run ./pull-backups.sh on server

> ./pull-backups.sh



## Manual

Load the image on the server

> docker load < ./pterodactyl-backups-latest.tar.gz

Run it (optionally add it to a cronjob)

> docker run --env-file .env -v "./syncs:/app/syncs" pterodactyl-backups:latest
