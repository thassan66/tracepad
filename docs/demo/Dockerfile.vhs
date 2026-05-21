FROM ghcr.io/charmbracelet/vhs:latest

USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends git nodejs npm \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /work
