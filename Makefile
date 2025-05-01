# Set variables
IMAGE_NAME = pterodactyl-backups
TAG = latest
TAR_NAME = $(IMAGE_NAME)-$(TAG).tar.gz

all: build export

build:
	docker build -t $(IMAGE_NAME):$(TAG) .

export: build
	docker save $(IMAGE_NAME):$(TAG) | gzip > $(TAR_NAME)
	echo "Image saved as $(TAR_NAME)"

clean:
	docker rmi $(IMAGE_NAME):$(TAG)

.PHONY: all build export clean