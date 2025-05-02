IMAGE_NAME = pterodactyl-backups
TAG = latest

all: amd64 arm64

amd64:
	docker buildx build --platform linux/amd64 --output type=docker -t $(IMAGE_NAME):$(TAG)-amd64 .
	docker save $(IMAGE_NAME):$(TAG)-amd64 | gzip > $(IMAGE_NAME)-$(TAG)-amd64.tar.gz

arm64:
	docker buildx build --platform linux/arm64 --output type=docker -t $(IMAGE_NAME):$(TAG)-arm64 .
	docker save $(IMAGE_NAME):$(TAG)-arm64 | gzip > $(IMAGE_NAME)-$(TAG)-arm64.tar.gz

clean:
	docker rmi $(IMAGE_NAME):$(TAG)-amd64 || true
	docker rmi $(IMAGE_NAME):$(TAG)-arm64 || true

.PHONY: all amd64 arm64 clean