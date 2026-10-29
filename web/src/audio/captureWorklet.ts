// Runs on the browser's audio thread: forwards microphone samples to the page in ~85 ms blocks.
// Bundled separately by Vite (imported with ?worker&url) and loaded with audioWorklet.addModule().

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BLOCK = 4096;

class CaptureProcessor extends AudioWorkletProcessor {
  private block = new Float32Array(BLOCK);
  private filled = 0;

  constructor() {
    super();
    // 'flush' sends what is left, so the last words before Stop are not cut off.
    this.port.onmessage = () => {
      this.port.postMessage(this.block.slice(0, this.filled));
      this.filled = 0;
      this.port.postMessage('flushed');
    };
  }

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (const sample of channel) {
        this.block[this.filled++] = sample;
        if (this.filled === BLOCK) {
          this.port.postMessage(this.block.slice());
          this.filled = 0;
        }
      }
    }
    return true; // keep running until the page disconnects us
  }
}

registerProcessor('capture', CaptureProcessor);
