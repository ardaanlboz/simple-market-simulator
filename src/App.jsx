import { useSimulation } from './hooks/useSimulation.js';
import Layout from './components/Layout.jsx';

export default function App() {
  const sim = useSimulation();

  return <Layout sim={sim} />;
}
