# whisper.cpp HTTP server (MIT). Built from a pinned release tag; models are mounted read-only at /models.
FROM debian:bookworm-20261020-slim AS build
ARG WHISPER_CPP_TAG=v1.9.5
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$WHISPER_CPP_TAG" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
# GGML_NATIVE tunes for the CPU that builds the image (this machine: AVX2, AVX-VNNI). Static: one binary, no .so files.
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=ON \
      -DWHISPER_BUILD_TESTS=OFF -DWHISPER_SDL2=OFF \
    && cmake --build build -j"$(nproc)" --target whisper-server

FROM debian:bookworm-20261020-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 curl \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
ARG UID=1000
RUN useradd --uid "$UID" --create-home whisper
USER whisper
WORKDIR /home/whisper
EXPOSE 8080
# English only (-l en), no extra language-detection pass (-nlp), and no "[Music]"-style tokens (-sns).
CMD ["sh", "-c", "exec whisper-server --host 0.0.0.0 --port 8080 -m \"/models/$WHISPER_MODEL\" -t \"$WHISPER_THREADS\" -l en -nlp -sns"]
