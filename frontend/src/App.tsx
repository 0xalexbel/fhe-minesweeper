import { useEffect, useState } from 'react';
//import { Devnet } from './components/Devnet';
import { init } from './fhevmjs';
import './App.css';
import { Connect } from './components/Connect';
import { Minesweeper } from './components/Minesweeper';

function App() {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    init()
      .then(() => {
        setIsInitialized(true);
      })
      .catch(() => setIsInitialized(false));
  }, []);

  if (!isInitialized) return null;

  return (
    <Connect>
      {(account, provider, readOnlyProvider) => (
        <Minesweeper
          account={account}
          provider={provider}
          readOnlyProvider={readOnlyProvider}
        />
      )}
    </Connect>
  );
}

export default App;
