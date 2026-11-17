import { AudioBridgeStatus } from './AudioBridgeStatus';
import { useDiagnosticsTap } from '../audio/diagnosticsTap';

/** AudioBridge diagnostics wired to the live player tap. Used only on the Developer Mode (Neural Twin) page. */
export function AudioBridgeConnected() {
  const tap = useDiagnosticsTap();
  return <AudioBridgeStatus analyser={tap.analyser} bufferLine={tap.bufferLine} onCopyBufferLog={tap.onCopyBufferLog} />;
}
