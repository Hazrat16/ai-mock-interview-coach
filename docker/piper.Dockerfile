# Piper text-to-speech HTTP server (GPL-3.0, run locally, not distributed). Voices are mounted read-only at /voices.
FROM python:3.13.17-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY piper-requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt && rm /tmp/requirements.txt

# Same uid as the host user, so the bind-mounted voices are readable and `pkill` from the host works.
ARG UID=1000
RUN useradd --uid "$UID" --create-home piper
USER piper
WORKDIR /voices

EXPOSE 5000
# Voice files are found by name in /voices (en_US-ljspeech-medium -> /voices/en_US-ljspeech-medium.onnx).
CMD ["sh", "-c", "exec python -m piper.http_server --host 0.0.0.0 --port 5000 --data-dir /voices -m \"$PIPER_VOICE\""]
