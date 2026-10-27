import { createRoot } from 'react-dom/client';
import './h.css';
import { HomeBroadcastHub } from '../src/components/HomeBroadcastHub';
import { peekChannelFocus } from '../src/guide/focusRequest';
const w = window as any; w.__plays = []; w.__navs = [];
w.__peek = (g: string) => peekChannelFocus(g);
createRoot(document.getElementById('root')!).render(
  <HomeBroadcastHub onPlayProgram={(...a: any[]) => { w.__plays.push(a); }} onNavigate={(d: any) => { w.__navs.push(d); }} />);
