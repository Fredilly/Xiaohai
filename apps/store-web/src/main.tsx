import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main>
      <h1>胖竹门店端</h1>
      <p>Store Web foundation is ready.</p>
    </main>
  );
}

const root = document.querySelector<HTMLDivElement>('#root');
if (!root) throw new Error('Root element is missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
