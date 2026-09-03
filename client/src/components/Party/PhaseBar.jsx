import { usePhaseTimer } from './usePhaseTimer';

/** Barre de progression de la phase, partagée par le grand écran et les téléphones. */
function PhaseBar({ remainingMs, duration }) {
    const { ratio, urgent } = usePhaseTimer(remainingMs, duration);
    return (
        <div className="pty-timer-track">
            <div
                className={`pty-timer-fill ${urgent ? 'pty-timer-fill-urgent' : ''}`}
                style={{ width: `${ratio * 100}%` }}
            />
        </div>
    );
}

export default PhaseBar;
