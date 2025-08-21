class PCMWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.postMessage({ type: 'ready', sampleRate: sampleRate });
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length) {
      this.port.postMessage({ type: 'chunk', data: input[0] });
    }
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorkletProcessor);
