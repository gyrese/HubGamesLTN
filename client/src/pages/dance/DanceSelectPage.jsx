import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Monitor, Smartphone, Upload, Trash2 } from 'lucide-react';
import { analyzeAudioFile } from '../../components/Dance/danceEngine';
import '../../components/Dance/DanceStyles.css';

/**
 * DANCE_DANCE — page d'entrée.
 *
 * Elle porte aussi la gestion du catalogue, parce que le jeu ne peut rien faire
 * sans morceau : le hub n'embarque aucune musique, et pour cause — les packs de
 * chansons de StepMania sont sous copyright et non redistribuables. L'hôte
 * dépose donc ses propres fichiers.
 *
 * ── Le tempo est mesuré ici, dans le navigateur ─────────────────────
 * Décoder un MP3 côté serveur demanderait ffmpeg ou un module natif, donc une
 * image Docker plus lourde pour un seul jeu. Le navigateur sait déjà le faire
 * (Web Audio API) : on analyse avant l'envoi et on transmet le tempo mesuré.
 * Le serveur borne ces valeurs, il ne leur fait pas confiance.
 */
function DanceSelectPage() {
    const navigate = useNavigate();
    const fileRef = useRef(null);

    const [songs, setSongs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [analysis, setAnalysis] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ title: '', artist: '', file: null });

    useEffect(() => {
        document.body.classList.add('dance-theme');
        return () => document.body.classList.remove('dance-theme');
    }, []);

    const loadSongs = useCallback(async () => {
        try {
            const res = await fetch('/api/dance/songs');
            const data = await res.json();
            setSongs(data.songs || []);
        } catch {
            setError('Catalogue indisponible');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadSongs(); }, [loadSongs]);

    /** Analyse du fichier choisi : tempo et durée, avant tout envoi. */
    const onFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setError('');
        setAnalysis(null);
        setForm((f) => ({
            ...f,
            file,
            // Le nom du fichier est presque toujours le titre : autant le
            // proposer plutôt que de faire retaper.
            title: f.title || file.name.replace(/\.[^.]+$/, ''),
        }));

        try {
            setAnalysis({ pending: true });
            const measured = await analyzeAudioFile(file);
            setAnalysis(measured);
        } catch (err) {
            console.error('[DANCE] Analyse impossible', err);
            setAnalysis(null);
            setError('Fichier audio illisible');
        }
    }, []);

    const upload = useCallback(async () => {
        if (!form.file || !analysis || analysis.pending) return;

        setUploading(true);
        setError('');

        const body = new FormData();
        body.append('audio', form.file);
        body.append('title', form.title);
        body.append('artist', form.artist);
        body.append('bpm', String(analysis.bpm));
        body.append('durationMs', String(analysis.durationMs));

        try {
            const token = localStorage.getItem('admin_token');
            const res = await fetch('/api/dance/songs', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body,
            });
            const data = await res.json();

            if (!res.ok) {
                setError(data.error || (res.status === 401
                    ? 'Connectez-vous à l\'administration pour ajouter un morceau'
                    : 'Envoi impossible'));
            } else {
                setForm({ title: '', artist: '', file: null });
                setAnalysis(null);
                if (fileRef.current) fileRef.current.value = '';
                loadSongs();
            }
        } catch {
            setError('Envoi impossible');
        } finally {
            setUploading(false);
        }
    }, [form, analysis, loadSongs]);

    const removeSong = useCallback(async (id) => {
        const token = localStorage.getItem('admin_token');
        try {
            const res = await fetch(`/api/dance/songs/${id}`, {
                method: 'DELETE',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) loadSongs();
            else setError('Suppression réservée à l\'administration');
        } catch {
            setError('Suppression impossible');
        }
    }, [loadSongs]);

    return (
        <div className="dd-root" style={{ minHeight: '100dvh', padding: 24 }}>
            <button
                className="dd-btn dd-btn-ghost mb-6 inline-flex items-center gap-2"
                onClick={() => navigate('/')}
            >
                <ArrowLeft size={16} /> Retour
            </button>

            <main className="mx-auto flex flex-col gap-6" style={{ maxWidth: 900 }}>
                <div className="text-center">
                    <p className="dd-eyebrow">Jeu de rythme · le téléphone devient un tapis de danse</p>
                    <h1 className="dd-title">Dance <span className="dd-title-accent">Dance</span></h1>
                    <p style={{ color: 'var(--dd-muted)', marginTop: 8 }}>
                        Les flèches descendent, on tape en rythme. Chacun suit sa piste sur
                        son écran, le classement s'affiche en direct sur le grand écran.
                    </p>
                </div>

                {/* Lancement */}
                <section className="dd-panel p-6 flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        className="dd-btn inline-flex items-center justify-center gap-2"
                        onClick={() => navigate('/dance/host')}
                    >
                        <Monitor size={18} /> Ouvrir le grand écran
                    </button>
                    <button
                        className="dd-btn dd-btn-ghost inline-flex items-center justify-center gap-2"
                        onClick={() => navigate('/dance/play')}
                    >
                        <Smartphone size={18} /> Rejoindre une partie
                    </button>
                </section>

                {/* Catalogue */}
                <section className="dd-panel p-6 flex flex-col gap-4">
                    <p className="dd-eyebrow">Catalogue ({songs.length})</p>

                    {loading ? (
                        <Loader2 className="animate-spin mx-auto" size={22} />
                    ) : songs.length === 0 ? (
                        <p style={{ color: 'var(--dd-muted)', fontSize: 14 }}>
                            Aucun morceau pour l'instant. Ajoutez un fichier audio dont vous
                            avez les droits : le tempo est détecté et la chorégraphie générée
                            automatiquement, avec quatre niveaux de difficulté.
                        </p>
                    ) : (
                        <div className="dd-song-grid">
                            {songs.map((s) => (
                                <div key={s.id} className="dd-song-card">
                                    <div className="flex items-start justify-between gap-2">
                                        <div style={{ minWidth: 0 }}>
                                            <div className="dd-song-title">{s.title}</div>
                                            <div className="dd-song-meta">{s.artist}</div>
                                            <div className="dd-song-meta">
                                                {s.bpm} BPM · {Math.floor(s.durationMs / 60000)}:
                                                {String(Math.floor((s.durationMs % 60000) / 1000)).padStart(2, '0')}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => removeSong(s.id)}
                                            style={{ color: 'var(--dd-muted)', padding: 6 }}
                                            aria-label={`Supprimer ${s.title}`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                {/* Ajout d'un morceau */}
                <section className="dd-panel p-6 flex flex-col gap-4">
                    <p className="dd-eyebrow">Ajouter un morceau</p>

                    <input
                        ref={fileRef}
                        type="file"
                        accept="audio/*"
                        onChange={onFile}
                        style={{ color: 'var(--dd-muted)', fontSize: 14 }}
                    />

                    {analysis?.pending && (
                        <p className="dd-eyebrow inline-flex items-center gap-2">
                            <Loader2 className="animate-spin" size={14} /> Analyse du tempo…
                        </p>
                    )}

                    {analysis && !analysis.pending && (
                        <div className="dd-song-card">
                            <div className="dd-song-meta">
                                Tempo détecté : <strong style={{ color: 'var(--dd-ink)' }}>{analysis.bpm} BPM</strong>
                                {' · '}durée {Math.floor(analysis.durationMs / 60000)}:
                                {String(Math.floor((analysis.durationMs % 60000) / 1000)).padStart(2, '0')}
                            </div>
                        </div>
                    )}

                    <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <input
                            className="dd-panel px-4 py-3"
                            style={{ background: 'rgba(255,255,255,0.05)' }}
                            placeholder="Titre"
                            maxLength={60}
                            value={form.title}
                            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                        />
                        <input
                            className="dd-panel px-4 py-3"
                            style={{ background: 'rgba(255,255,255,0.05)' }}
                            placeholder="Artiste"
                            maxLength={60}
                            value={form.artist}
                            onChange={(e) => setForm((f) => ({ ...f, artist: e.target.value }))}
                        />
                    </div>

                    {error && <p style={{ color: '#f87171', fontSize: 13 }}>{error}</p>}

                    <button
                        className="dd-btn inline-flex items-center justify-center gap-2"
                        onClick={upload}
                        disabled={uploading || !form.file || !analysis || analysis.pending}
                    >
                        {uploading
                            ? <Loader2 className="animate-spin" size={18} />
                            : <><Upload size={18} /> Ajouter au catalogue</>}
                    </button>

                    <p style={{ color: 'var(--dd-muted)', fontSize: 12 }}>
                        N'ajoutez que des morceaux dont vous détenez les droits ou libres de
                        droits. L'ajout demande d'être connecté à l'administration.
                    </p>
                </section>
            </main>
        </div>
    );
}

export default DanceSelectPage;
