import { useEffect, useMemo, useRef, useState } from 'react';

export const FREQUENCIES = [20, 31, 40, 63, 80, 125, 250, 500, 1000, 2000, 4000, 8000, 10000, 12000, 16000, 20000];
export const DEFAULT_SETTINGS = {
  eq: Array(16).fill(0),
  presetName: 'Flat',
  bassEnabled: false,
  bassIntensity: 50,
  bassGain: 4,
  highPass: 20,
  lowPass: 20000,
  filterSlope: 12,
  subEnabled: false,
  crossover: 80,
  subVolume: 35,
  subGain: 3,
  subSlope: 24,
  latency: 0,
  volume: 80,
  outputDevice: 'default',
  customPresets: {}
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

export function compensatePlaybackPosition(positionSeconds, latencyMilliseconds) {
  return Math.max(0, Number(positionSeconds) + (Number(latencyMilliseconds) || 0) / 1000);
}

export function useAudioProcessing(audioRef, settings, enabled) {
  const graph = useRef(null);
  const [graphReady, setGraphReady] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!enabled || !audio || !window.AudioContext) {
      setGraphReady(false);
      return undefined;
    }
    const context = new window.AudioContext();
    const source = context.createMediaElementSource(audio);
    const highPass = [context.createBiquadFilter(), context.createBiquadFilter()];
    highPass.forEach((filter) => { filter.type = 'highpass'; });
    const lowPass = [context.createBiquadFilter(), context.createBiquadFilter()];
    lowPass.forEach((filter) => { filter.type = 'lowpass'; });
    const equalizers = FREQUENCIES.map((frequency) => {
      const filter = context.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = 1.15;
      return filter;
    });
    const bass = context.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 110;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -12;
    compressor.ratio.value = 3;
    const master = context.createGain();
    const subLowPass = [context.createBiquadFilter(), context.createBiquadFilter()];
    subLowPass.forEach((filter) => { filter.type = 'lowpass'; });
    const subGain = context.createGain();

    source.connect(highPass[0]);
    highPass[0].connect(highPass[1]);
    let tail = highPass[1];
    for (const filter of equalizers) {
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(lowPass[0]);
    lowPass[0].connect(lowPass[1]);
    lowPass[1].connect(bass);
    bass.connect(compressor);
    compressor.connect(master);
    master.connect(context.destination);
    source.connect(subLowPass[0]);
    subLowPass[0].connect(subLowPass[1]);
    subLowPass[1].connect(subGain);
    subGain.connect(compressor);

    graph.current = { context, highPass, lowPass, equalizers, bass, master, subLowPass, subGain };
    setGraphReady(true);
    return () => {
      source.disconnect();
      void context.close();
      graph.current = null;
      setGraphReady(false);
    };
  }, [audioRef, enabled]);

  useEffect(() => {
    const nodes = graph.current;
    if (!nodes) return;
    const now = nodes.context.currentTime;
    nodes.highPass.forEach((filter, index) => {
      filter.type = index === 1 && settings.filterSlope < 24 ? 'allpass' : 'highpass';
      filter.frequency.setTargetAtTime(clamp(settings.highPass, 20, 20000), now, 0.04);
      filter.Q.value = 0.707;
    });
    nodes.lowPass.forEach((filter, index) => {
      filter.type = index === 1 && settings.filterSlope < 24 ? 'allpass' : 'lowpass';
      filter.frequency.setTargetAtTime(clamp(settings.lowPass, 20, 20000), now, 0.04);
      filter.Q.value = 0.707;
    });
    nodes.equalizers.forEach((filter, index) => {
      filter.gain.setTargetAtTime(clamp(settings.eq[index], -12, 12), now, 0.04);
    });
    const bassGain = settings.bassEnabled
      ? clamp(settings.bassGain, 0, 12) * clamp(settings.bassIntensity, 0, 100) / 100
      : 0;
    nodes.bass.gain.setTargetAtTime(bassGain, now, 0.06);
    nodes.master.gain.setTargetAtTime(clamp(settings.volume, 0, 100) / 100, now, 0.04);
    nodes.subLowPass.forEach((filter, index) => {
      filter.type = index === 1 && settings.subSlope < 24 ? 'allpass' : 'lowpass';
      filter.frequency.setTargetAtTime(clamp(settings.crossover, 20, 250), now, 0.04);
      filter.Q.value = 0.707;
    });
    nodes.subGain.gain.setTargetAtTime(
      settings.subEnabled ? clamp(settings.subVolume, 0, 100) / 100 * (1 + clamp(settings.subGain, 0, 12) / 12) : 0,
      now,
      0.06
    );
  }, [settings]);

  return useMemo(() => ({
    resume: () => graph.current?.context.resume(),
    setOutputDevice: async (deviceId) => {
      const context = graph.current?.context;
      if (!context?.setSinkId) {
        if (deviceId !== 'default') throw new Error('This browser does not support selecting an audio output device for processed audio.');
        return;
      }
      await context.setSinkId(deviceId);
    },
    context: () => graph.current?.context,
    isReady: graphReady,
    isSupported: typeof window !== 'undefined' && Boolean(window.AudioContext)
  }), [graphReady]);
}
