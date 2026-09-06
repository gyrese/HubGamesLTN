import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { socket } from './socket';

// Pages
import HomePage from './pages/HomePage';
import JoinPage from './pages/JoinPage';

// Quiz
import QuizSelectPage from './pages/quiz/QuizSelectPage';
import HostView from './components/Host/HostView';
import PlayerView from './components/Player/PlayerView';

// CouleurMoi
import ColorSelectPage from './pages/color/ColorSelectPage';
import ColorHostView from './components/Color/ColorHostView';
import ColorPlayerView from './components/Color/ColorPlayerView';

// Geo
import GeoSelectPage from './pages/geo/GeoSelectPage';
import GeoHostView from './components/Geo/GeoHostView';
import GeoPlayerView from './components/Geo/GeoPlayerView';
import GeoRemoteView from './components/Geo/GeoRemoteView';

// Draw
import DrawSelectPage from './pages/draw/DrawSelectPage';
import DrawHostView from './components/Draw/DrawHostView';
import DrawPlayerView from './components/Draw/DrawPlayerView';

// Fake Artist
import FakeArtistSelectPage from './pages/fakeArtist/FakeArtistSelectPage';
import FakeArtistHostView from './components/FakeArtist/FakeArtistHostView';
import FakeArtistPlayerView from './components/FakeArtist/FakeArtistPlayerView';

// Super LTN Party
import PartySelectPage from './pages/party/PartySelectPage';
import PartyHostView from './components/Party/PartyHostView';
import PartyPlayerView from './components/Party/PartyPlayerView';

// IO Arena
import IoSelectPage from './pages/io/IoSelectPage';
import IoHostView from './components/Io/IoHostView';
import IoPlayerView from './components/Io/IoPlayerView';

// Dance Dance
import DanceSelectPage from './pages/dance/DanceSelectPage';
import DanceHostView from './components/Dance/DanceHostView';
import DancePlayerView from './components/Dance/DancePlayerView';

// Admin
import AdminView from './components/Admin/AdminView';

function App() {
  const [isConnected, setIsConnected] = useState(socket.connected);

  useEffect(() => {
    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app">
        {/* {!isConnected && (
          <div style={{ backgroundColor: 'red', color: 'white', textAlign: 'center', padding: '5px' }}>
            DÉCONNECTÉ DU SERVEUR
          </div>
        )} */}

        <Routes>
          {/* Home */}
          <Route path="/" element={<HomePage />} />

          {/* Join - Universal join page */}
          <Route path="/join" element={<JoinPage />} />
          <Route path="/join/:roomCode" element={<JoinPage />} />

          {/* Neural Quiz */}
          <Route path="/quiz" element={<QuizSelectPage />} />
          <Route path="/quiz/host" element={<HostView />} />
          <Route path="/quiz/play" element={<PlayerView />} />
          <Route path="/quiz/play/:roomCode" element={<PlayerView />} />

          {/* CouleurMoi */}
          <Route path="/color" element={<ColorSelectPage />} />
          <Route path="/color/host" element={<ColorHostView />} />
          <Route path="/color/play" element={<ColorPlayerView />} />
          <Route path="/color/play/:roomCode" element={<ColorPlayerView />} />

          {/* GeoTrackr */}
          <Route path="/geo" element={<GeoSelectPage />} />
          <Route path="/geo/host" element={<GeoHostView />} />
          <Route path="/geo/play" element={<GeoPlayerView />} />
          <Route path="/geo/play/:roomCode" element={<GeoPlayerView />} />
          <Route path="/geo/remote" element={<GeoRemoteView />} />
          <Route path="/geo/remote/:roomCode" element={<GeoRemoteView />} />

          {/* Draw Up */}
          <Route path="/draw" element={<DrawSelectPage />} />
          <Route path="/draw/host" element={<DrawHostView />} />
          <Route path="/draw/play" element={<DrawPlayerView />} />
          <Route path="/draw/play/:roomCode" element={<DrawPlayerView />} />

          {/* Fake Artist */}
          <Route path="/fakeartist" element={<FakeArtistSelectPage />} />
          <Route path="/fakeartist/host" element={<FakeArtistHostView />} />
          <Route path="/fakeartist/play" element={<FakeArtistPlayerView />} />
          <Route path="/fakeartist/play/:roomCode" element={<FakeArtistPlayerView />} />

          {/* Super LTN Party */}
          <Route path="/party" element={<PartySelectPage />} />
          <Route path="/party/host" element={<PartyHostView />} />
          <Route path="/party/play" element={<PartyPlayerView />} />
          <Route path="/party/play/:roomCode" element={<PartyPlayerView />} />

          {/* IO Arena */}
          <Route path="/io" element={<IoSelectPage />} />
          <Route path="/io/host" element={<IoHostView />} />
          <Route path="/io/play" element={<IoPlayerView />} />
          <Route path="/io/play/:roomCode" element={<IoPlayerView />} />

          {/* Dance Dance */}
          <Route path="/dance" element={<DanceSelectPage />} />
          <Route path="/dance/host" element={<DanceHostView />} />
          <Route path="/dance/host/:roomCode" element={<DanceHostView />} />
          <Route path="/dance/play" element={<DancePlayerView />} />
          <Route path="/dance/play/:roomCode" element={<DancePlayerView />} />

          {/* Admin */}
          <Route path="/admin" element={<AdminView />} />

          {/* Catch all - redirect to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
