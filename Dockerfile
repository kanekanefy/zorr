# syntax=docker/dockerfile:1.7

# ---------- Stage 1: builder ----------
FROM emscripten/emsdk:3.1.74 AS builder

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      cmake g++ make git patch \
      libuv1-dev zlib1g-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY upstream/gardn/ ./

# Apply our patches (filename order matters: 0001, 0002, 0003)
COPY patches/ /patches/
RUN if ls /patches/*.patch >/dev/null 2>&1; then \
      for p in /patches/*.patch; do echo ">>> Applying $p" && patch -p1 < "$p" ; done ; \
    else echo "No patches to apply." ; fi

# Client (WASM)
RUN cmake -S Client -B Client/build -DDEBUG=0 && \
    cmake --build Client/build -j"$(nproc)"

# Server (WASM-Node mode)
RUN cmake -S Server -B Server/build -DWASM_SERVER=1 -DDEBUG=0 && \
    cmake --build Server/build -j"$(nproc)"

# Collect runtime artifacts
RUN mkdir -p /out && \
    cp Server/build/gardn-server.js Server/build/gardn-server.wasm /out/ && \
    cp Client/build/gardn-client.js Client/build/gardn-client.wasm /out/ && \
    cp Client/public/index.html /out/

# ---------- Stage 2: runtime ----------
FROM node:20-alpine

WORKDIR /app

# WASM-Node server only needs ws (per gardn INSTALLATION.md)
RUN npm install --omit=dev ws

COPY --from=builder /out/ ./

EXPOSE 9001

CMD ["node", "gardn-server.js"]
