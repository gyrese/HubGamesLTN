import { useState, useEffect } from 'react';
import ColorImageStudio from './ColorImageStudio';

const isHttps = window.location.protocol === 'https:';
const serverPort = isHttps ? 3443 : 3005;
const API_URL = import.meta.env.VITE_SERVER_URL 
    ? `${import.meta.env.VITE_SERVER_URL}/api`
    : (!import.meta.env.DEV ? '/api' : `${window.location.protocol}//${window.location.hostname}:${serverPort}/api`);

function ColorAdmin() {
    const [characters, setCharacters] = useState([]);
    const [formCharacter, setFormCharacter] = useState({
        id: '',
        name: '',
        part: '',
        source: '',
        target_h: 0,
        target_s: 0,
        target_b: 0,
        image_path: ''
    });
    
    const [imageFile, setImageFile] = useState(null);
    const [processedBlob, setProcessedBlob] = useState(null); // WebP détouré exporté par le studio
    const [isEditing, setIsEditing] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        fetchCharacters();
    }, []);

    const fetchCharacters = async () => {
        try {
            const res = await fetch(`${API_URL}/color/characters`);
            if (res.ok) {
                const data = await res.json();
                setCharacters(data);
            } else {
                setError('Erreur lors du chargement des personnages');
            }
        } catch (err) {
            console.error(err);
            setError('Erreur réseau lors du chargement des personnages');
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormCharacter(prev => ({
            ...prev,
            [name]: ['target_h', 'target_s', 'target_b'].includes(name) ? parseInt(value) || 0 : value
        }));
    };

    const handleFileChange = (e) => {
        if (e.target.files && e.target.files[0]) {
            setImageFile(e.target.files[0]);
            setProcessedBlob(null); // sera regénéré par le studio
        }
    };

    // Le studio renvoie soit le WebP détouré (blob), soit une couleur échantillonnée (hsb)
    const handleStudioChange = ({ blob, hsb }) => {
        if (blob) setProcessedBlob(blob);
        if (hsb) setFormCharacter(prev => ({
            ...prev, target_h: hsb.h, target_s: hsb.s, target_b: hsb.b
        }));
    };

    const handleReset = () => {
        setFormCharacter({
            id: '',
            name: '',
            part: '',
            source: '',
            target_h: 0,
            target_s: 0,
            target_b: 0,
            image_path: ''
        });
        setImageFile(null);
        setProcessedBlob(null);
        setIsEditing(false);
        setError('');
        setSuccess('');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        setIsLoading(true);

        const { id, name, part, source, target_h, target_s, target_b, image_path } = formCharacter;

        if (!id.trim() || !name.trim() || !part.trim() || !source.trim()) {
            setError('Tous les champs texte sont requis');
            setIsLoading(false);
            return;
        }

        try {
            let finalImagePath = image_path;

            // 1. Upload : on privilégie le WebP détouré par le studio, sinon le fichier brut
            if (processedBlob || imageFile) {
                const formData = new FormData();
                if (processedBlob) {
                    formData.append('image', processedBlob, `${id.trim() || 'char'}.webp`);
                } else {
                    formData.append('image', imageFile);
                }

                const uploadRes = await fetch(`${API_URL}/admin/color/upload`, {
                    method: 'POST',
                    body: formData
                    // Bearer token automatically added by fetch interceptor
                });

                if (!uploadRes.ok) {
                    const errData = await uploadRes.json();
                    throw new Error(errData.error || "Erreur lors de l'upload du fichier WebP");
                }

                const uploadData = await uploadRes.json();
                finalImagePath = uploadData.url;
            }

            if (!finalImagePath && !isEditing) {
                throw new Error("L'image est requise lors de la création d'un nouveau personnage");
            }

            // 2. Save character metadata
            const characterData = {
                id: id.trim(),
                name: name.trim(),
                part: part.trim(),
                source: source.trim(),
                target_h: parseInt(target_h),
                target_s: parseInt(target_s),
                target_b: parseInt(target_b),
                image_path: finalImagePath
            };

            const saveUrl = isEditing 
                ? `${API_URL}/admin/color/characters/${id}`
                : `${API_URL}/admin/color/characters`;
            const saveMethod = isEditing ? 'PUT' : 'POST';

            const saveRes = await fetch(saveUrl, {
                method: saveMethod,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(characterData)
            });

            if (!saveRes.ok) {
                const errData = await saveRes.json();
                throw new Error(errData.error || "Erreur lors de l'enregistrement du personnage");
            }

            setSuccess(isEditing ? 'Personnage mis à jour avec succès !' : 'Personnage créé avec succès !');
            handleReset();
            fetchCharacters();
        } catch (err) {
            console.error(err);
            setError(err.message || "Une erreur est survenue");
        } finally {
            setIsLoading(false);
        }
    };

    const handleEdit = (char) => {
        setFormCharacter(char);
        setIsEditing(true);
        setError('');
        setSuccess('');
    };

    const handleDelete = async (id) => {
        if (!window.confirm("Voulez-vous vraiment supprimer ce personnage ?")) return;

        setError('');
        setSuccess('');

        try {
            const res = await fetch(`${API_URL}/admin/color/characters/${id}`, {
                method: 'DELETE'
            });

            if (res.ok) {
                setSuccess('Personnage supprimé !');
                fetchCharacters();
                if (formCharacter.id === id) {
                    handleReset();
                }
            } else {
                const errData = await res.json();
                setError(errData.error || 'Erreur lors de la suppression');
            }
        } catch (err) {
            console.error(err);
            setError('Erreur réseau lors de la suppression');
        }
    };

    // Helper to render target color swatch in list
    const getTargetColorStyle = (h, s, b) => {
        const v = b / 100;
        const sHsb = s / 100;
        const l = v * (1 - sHsb / 2);
        const sHsl = (l === 0 || l === 1) ? 0 : (v - l) / Math.min(l, 1 - l);
        return `hsl(${h}, ${Math.round(sHsl * 100)}%, ${Math.round(l * 100)}%)`;
    };

    const getImageUrl = (imagePath) => {
        if (!imagePath) return '';
        if (imagePath.startsWith('http') || imagePath.startsWith('data:')) return imagePath;
        const base = import.meta.env.VITE_SERVER_URL 
            ? import.meta.env.VITE_SERVER_URL 
            : (!import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:${serverPort}`);
        return `${base}${imagePath}`;
    };

    return (
        <div className="card shadow-sm bg-transparent border-secondary p-4 mt-2 text-light">
            <h2 className="text-primary mb-4">🎨 CouleurMoi — Administration des Personnages</h2>

            {error && <div className="alert alert-danger mb-4">{error}</div>}
            {success && <div className="alert alert-success mb-4">{success}</div>}

            <div className="row g-4">
                
                {/* 1. Editor Form */}
                <div className="col-lg-4">
                    <div className="bg-dark p-3 border border-secondary rounded">
                        <h4 className="text-info mb-3">
                            {isEditing ? 'Éditer le Personnage' : 'Ajouter un Personnage'}
                        </h4>
                        
                        <form onSubmit={handleSubmit} className="d-flex flex-col gap-3">
                            <div className="mb-2">
                                <label className="form-label text-muted small mb-1">Identifiant Unique (ID)</label>
                                <input 
                                    type="text" name="id" value={formCharacter.id}
                                    onChange={handleInputChange} disabled={isEditing}
                                    placeholder="pikachu-skin" className="form-control bg-black text-white border-secondary"
                                />
                            </div>

                            <div className="mb-2">
                                <label className="form-label text-muted small mb-1">Nom du Personnage</label>
                                <input 
                                    type="text" name="name" value={formCharacter.name}
                                    onChange={handleInputChange} placeholder="Pikachu"
                                    className="form-control bg-black text-white border-secondary"
                                />
                            </div>

                            <div className="mb-2">
                                <label className="form-label text-muted small mb-1">Partie à colorer</label>
                                <input 
                                    type="text" name="part" value={formCharacter.part}
                                    onChange={handleInputChange} placeholder="La peau"
                                    className="form-control bg-black text-white border-secondary"
                                />
                            </div>

                            <div className="mb-2">
                                <label className="form-label text-muted small mb-1">Source / Oeuvre d'origine</label>
                                <input 
                                    type="text" name="source" value={formCharacter.source}
                                    onChange={handleInputChange} placeholder="Pokémon"
                                    className="form-control bg-black text-white border-secondary"
                                />
                            </div>

                            <div className="row g-2 mb-2">
                                <div className="col-4">
                                    <label className="form-label text-muted small mb-1">Teinte (H)</label>
                                    <input 
                                        type="number" min="0" max="360" name="target_h" value={formCharacter.target_h}
                                        onChange={handleInputChange} className="form-control bg-black text-white border-secondary"
                                    />
                                </div>
                                <div className="col-4">
                                    <label className="form-label text-muted small mb-1">Sat (S %)</label>
                                    <input 
                                        type="number" min="0" max="100" name="target_s" value={formCharacter.target_s}
                                        onChange={handleInputChange} className="form-control bg-black text-white border-secondary"
                                    />
                                </div>
                                <div className="col-4">
                                    <label className="form-label text-muted small mb-1">Lumin (B %)</label>
                                    <input 
                                        type="number" min="0" max="100" name="target_b" value={formCharacter.target_b}
                                        onChange={handleInputChange} className="form-control bg-black text-white border-secondary"
                                    />
                                </div>
                            </div>

                            {/* Color Preview */}
                            <div className="d-flex items-center gap-2 mb-2 bg-slate-950 p-2 rounded border border-secondary">
                                <div 
                                    style={{
                                        width: '24px',
                                        height: '24px',
                                        borderRadius: '4px',
                                        backgroundColor: getTargetColorStyle(formCharacter.target_h, formCharacter.target_s, formCharacter.target_b)
                                    }}
                                />
                                <span className="small text-muted">Aperçu de la couleur cible</span>
                            </div>

                            <div className="mb-3">
                                <label className="form-label text-muted small mb-1">Image — détourage intégré</label>
                                <input
                                    type="file" accept="image/*" onChange={handleFileChange}
                                    className="form-control bg-black text-white border-secondary"
                                />
                                {formCharacter.image_path && !imageFile && (
                                    <div className="text-muted small mt-1 truncate">
                                        Actuel : {formCharacter.image_path}
                                    </div>
                                )}
                                {imageFile && (
                                    <ColorImageStudio
                                        file={imageFile}
                                        target={{ h: formCharacter.target_h, s: formCharacter.target_s, b: formCharacter.target_b }}
                                        onChange={handleStudioChange}
                                    />
                                )}
                            </div>

                            <div className="d-flex gap-2">
                                <button type="submit" disabled={isLoading} className="btn btn-primary flex-fill">
                                    {isLoading ? 'Enregistrement...' : 'Enregistrer'}
                                </button>
                                <button type="button" onClick={handleReset} className="btn btn-outline-secondary">
                                    Annuler
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                {/* 2. Character List Table */}
                <div className="col-lg-8">
                    <div className="table-responsive border border-secondary rounded">
                        <table className="table table-dark table-hover mb-0">
                            <thead>
                                <tr>
                                    <th>Image</th>
                                    <th>ID</th>
                                    <th>Nom</th>
                                    <th>Partie</th>
                                    <th>Source</th>
                                    <th>Cible HSB</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {characters.length === 0 ? (
                                    <tr>
                                        <td colSpan="7" className="text-center text-muted py-4">
                                            Aucun personnage disponible.
                                        </td>
                                    </tr>
                                ) : (
                                    characters.map(char => (
                                        <tr key={char.id} className="align-middle">
                                            <td>
                                                <div 
                                                    className="position-relative overflow-hidden rounded bg-slate-900 border border-slate-700"
                                                    style={{ width: '42px', height: '42px' }}
                                                >
                                                    <div 
                                                        className="position-absolute inset-0"
                                                        style={{ backgroundColor: getTargetColorStyle(char.target_h, char.target_s, char.target_b) }}
                                                    />
                                                    <img 
                                                        src={getImageUrl(char.image_path)} 
                                                        alt={char.name}
                                                        className="w-100 h-100 object-fit-contain position-relative z-1"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                </div>
                                            </td>
                                            <td className="small font-mono">{char.id}</td>
                                            <td className="fw-bold text-info">{char.name}</td>
                                            <td>{char.part}</td>
                                            <td className="text-muted">{char.source}</td>
                                            <td>
                                                <span className="badge bg-secondary font-mono">
                                                    H:{char.target_h} S:{char.target_s} B:{char.target_b}
                                                </span>
                                            </td>
                                            <td>
                                                <button onClick={() => handleEdit(char)} className="btn btn-sm btn-outline-light me-2">
                                                    ÉDITER
                                                </button>
                                                <button onClick={() => handleDelete(char.id)} className="btn btn-sm btn-outline-danger">
                                                    SUPPR
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default ColorAdmin;
