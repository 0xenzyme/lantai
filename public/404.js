// 404.html 的重定向脚本。独立成文件，避免 CSP 的 script-src 'self' 拦截内联脚本。
const path = location.pathname.replace(/\/+$/, '') || '/';
const query = new URLSearchParams(location.search);
query.set('path', path);
location.replace(`/?${query.toString()}${location.hash}`);
