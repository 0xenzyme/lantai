import { createRoot } from 'react-dom/client';
import { App } from './react/App';
import './styles.css';

const deepLink = new URLSearchParams(location.search).get('path');
if (deepLink?.startsWith('/') && !deepLink.startsWith('//') && !deepLink.includes('\\')) {
  const query = new URLSearchParams(location.search);
  query.delete('path');
  const suffix = query.toString();
  history.replaceState(history.state, '', `${deepLink}${suffix ? `?${suffix}` : ''}${location.hash}`);
}

const mount = document.getElementById('app');
if (!mount) throw new Error('缺少 React 挂载节点');
createRoot(mount).render(<App />);
