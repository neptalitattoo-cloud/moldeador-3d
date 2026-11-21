// Ejecuta K.fit fuera del hilo principal (core.js no usa el DOM).
import * as K from './core.js?v=13';
let base = null;
self.onmessage = ({ data: msg }) => {
  if (msg.type === 'init') {
    try {
      base = K.loadBase(msg.meta, msg.buf);
      self.postMessage({ type: 'ready' });
    } catch (e) {
      self.postMessage({ type: 'fatal', message: e.message });
    }
    return;
  }
  if (msg.type !== 'fit') return;
  const t0 = performance.now();
  try {
    const { P, report } = K.fit(base, msg.inp, line => self.postMessage({ type: 'progress', id: msg.id, line }));
    const rep = { ...report };
    delete rep.tape; // tape es una función: no se puede clonar
    self.postMessage({ type: 'done', id: msg.id, P, report: rep, ms: performance.now() - t0 }, [P.buffer]);
  } catch (e) {
    self.postMessage({ type: 'error', id: msg.id, message: e.message });
  }
};
