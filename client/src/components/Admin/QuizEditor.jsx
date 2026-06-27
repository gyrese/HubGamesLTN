import { useState } from 'react';
import { apiBase } from '../Quiz/quizShared';

function QuizEditor({ quiz, onSave, onCancel }) {
    const [title, setTitle] = useState(quiz ? quiz.title : '');
    const [description, setDescription] = useState(quiz ? quiz.description : '');
    const [questions, setQuestions] = useState(quiz ? quiz.questions : []);

    const handleAddQuestion = () => {
        setQuestions([...questions, {
            text: "Nouvelle Question",
            image: "",
            options: ["Option 1", "Option 2", "Option 3", "Option 4"],
            correct: 0,
            difficulty: 3,
            explanation: ""
        }]);
    };

    const handleQuestionChange = (index, field, value) => {
        const newQuestions = [...questions];
        newQuestions[index][field] = value;
        setQuestions(newQuestions);
    };

    const handleOptionChange = (qIndex, oIndex, value) => {
        const newQuestions = [...questions];
        newQuestions[qIndex].options[oIndex] = value;
        setQuestions(newQuestions);
    };

    const handleDeleteQuestion = (index) => {
        const newQuestions = questions.filter((_, i) => i !== index);
        setQuestions(newQuestions);
    };

    const handleSave = async () => {
        const quizData = { title, description, questions };
        const url = `${apiBase()}/quizzes` + (quiz ? `/${quiz.id}` : '');
        const method = quiz ? 'PUT' : 'POST';

        try {
            await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(quizData)
            });
            onSave();
        } catch (error) {
            console.error("Erreur sauvegarde:", error);
            alert("Erreur lors de la sauvegarde");
        }
    };

    return (
        <div className="container mt-5 text-light pb-5">
            <h2 className="glitch-text mb-4" data-text={quiz ? "ÉDITER QUIZ" : "NOUVEAU QUIZ"}>{quiz ? "ÉDITER QUIZ" : "NOUVEAU QUIZ"}</h2>

            <div className="card bg-transparent border-secondary mb-5">
                <div className="card-body">
                    <div className="mb-3">
                        <label className="form-label text-info">Titre</label>
                        <input className="form-control bg-dark text-light border-secondary" value={title} onChange={e => setTitle(e.target.value)} />
                    </div>

                    <div className="mb-3">
                        <label className="form-label text-info">Description</label>
                        <input className="form-control bg-dark text-light border-secondary" value={description} onChange={e => setDescription(e.target.value)} />
                    </div>
                </div>
            </div>

            <h3 className="mb-4 text-primary">QUESTIONS ({questions.length})</h3>

            {questions.map((q, qIdx) => (
                <div key={qIdx} className="card bg-transparent border-secondary mb-4">
                    <div className="card-header bg-transparent border-secondary d-flex justify-content-between align-items-center">
                        <h4 className="mb-0 text-light">Question {qIdx + 1}</h4>
                        <button className="btn btn-sm btn-danger" onClick={() => handleDeleteQuestion(qIdx)}>X</button>
                    </div>
                    <div className="card-body">
                        <div className="mb-3">
                            <label className="form-label text-muted">Texte</label>
                            <input className="form-control bg-dark text-light border-secondary" value={q.text} onChange={e => handleQuestionChange(qIdx, 'text', e.target.value)} />
                        </div>

                        <div className="row g-3 mb-3">
                            <div className="col-md-8">
                                <label className="form-label text-muted">Image URL (Optionnel)</label>
                                <input className="form-control bg-dark text-light border-secondary" value={q.image || ''} onChange={e => handleQuestionChange(qIdx, 'image', e.target.value)} />
                            </div>
                            <div className="col-md-4">
                                <label className="form-label text-muted">Difficulté (QI)</label>
                                <select className="form-select bg-dark text-light border-secondary"
                                    value={q.difficulty ?? 3}
                                    onChange={e => handleQuestionChange(qIdx, 'difficulty', Number(e.target.value))}>
                                    <option value={1}>1 · Très facile</option>
                                    <option value={2}>2 · Facile</option>
                                    <option value={3}>3 · Moyen</option>
                                    <option value={4}>4 · Difficile</option>
                                    <option value={5}>5 · Très difficile</option>
                                </select>
                            </div>
                        </div>

                        <div className="mb-3">
                            <label className="form-label text-muted">Explication (affichée après la réponse)</label>
                            <textarea className="form-control bg-dark text-light border-secondary" rows={2}
                                value={q.explanation || ''} onChange={e => handleQuestionChange(qIdx, 'explanation', e.target.value)}
                                placeholder="Pourquoi cette réponse est la bonne…" />
                        </div>

                        <div className="row g-3 mt-2">
                            {q.options.map((opt, oIdx) => (
                                <div key={oIdx} className="col-md-6">
                                    <div className="input-group">
                                        <div className="input-group-text bg-dark border-secondary">
                                            <input
                                                className="form-check-input mt-0"
                                                type="radio"
                                                name={`correct-${qIdx}`}
                                                checked={q.correct === oIdx}
                                                onChange={() => handleQuestionChange(qIdx, 'correct', oIdx)}
                                            />
                                        </div>
                                        <input
                                            className={`form-control bg-dark text-light border-secondary ${q.correct === oIdx ? 'border-success text-success' : ''}`}
                                            value={opt}
                                            onChange={e => handleOptionChange(qIdx, oIdx, e.target.value)}
                                            placeholder={`Option ${oIdx + 1}`}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ))}

            <button className="btn btn-outline-primary mb-5 w-100" onClick={handleAddQuestion}>+ AJOUTER QUESTION</button>

            <div className="fixed-bottom p-3 border-top border-secondary d-flex gap-3 justify-content-center" style={{ background: 'rgba(0,0,0,0.9)' }}>
                <button className="btn btn-primary px-5" onClick={handleSave}>SAUVEGARDER</button>
                <button className="btn btn-secondary px-5" onClick={onCancel}>ANNULER</button>
            </div>
        </div>
    );
}

export default QuizEditor;
