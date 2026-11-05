"use client";

import { useGame } from "@/lib/useGame";
import { useTextChat } from "@/lib/useTextChat";
import { useVoiceChat } from "@/lib/useVoiceChat";
import { useReactions } from "@/lib/useReactions";
import GameMenu from "./GameMenu";
import JoinForm from "./JoinForm";
import Lobby from "./Lobby";
import HidingPhase from "./HidingPhase";
import FindingPhase from "./FindingPhase";
import ResultsPhase from "./ResultsPhase";
import FinalScores from "./FinalScores";
import TextChat from "./TextChat";
import VoiceChat from "./VoiceChat";
import ReactionBar from "./ReactionBar";
import RoundStartNotice from "./RoundStartNotice";
import AmbientMusic from "./AmbientMusic";
import { useLanguage } from "@/lib/language";
import { useState, useEffect } from "react";

export default function GameRoom(props: { code: string }) {
  const { t } = useLanguage();
  const code = props.code;
  const game = useGame(code);

  const settings = game.state ? game.state.settings : null;
  const textChatEnabled = settings ? settings.textChat : false;
  const voiceChatEnabled = settings ? settings.voiceChat : false;

  const textChat = useTextChat(textChatEnabled);
  const players = game.state ? game.state.players : [];
  const youId = game.state ? game.state.youId : "";

  const voice = useVoiceChat(voiceChatEnabled, players, youId);
  // Reactions are a social feature, not a chat one: they work whenever the
  // room is in a round, even with text chat switched off.
  const inRound = game.state
    ? game.state.phase === "hiding" || game.state.phase === "finding"
    : false;
  const reactions = useReactions(inRound);
  
  // Сохраняем текущий чит, чтобы передать его в результаты
  const [currentCaseHint, setCurrentCaseHint] = useState<any>(null);

  // Сбрасываем чит при начале нового раунда
  useEffect(() => {
    if (game.state?.phase === "hiding" || (game.state?.phase === "finding" && game.state.guessedCount === 0)) {
      setCurrentCaseHint(null);
    }
  }, [game.state?.phase, game.state?.currentRound, game.state?.guessedCount]);


  if (game.status === "connecting") {
    return (
      <div className="center-screen">
        <p className="muted">{t("Connecting…")}</p>
      </div>
    );
  }

  if (game.status === "need-join" || !game.state) {
    return (
      <JoinForm
        code={code}
        error={game.error}
        onJoin={game.join}
        onPeek={game.peek}
      />
    );
  }

  const s = game.state;

  function renderPhase() {
    switch (s.phase) {
      case "lobby":
        return (
          <Lobby
            state={s}
            onStart={game.start}
            onUpdateSettings={game.updateSettings}
            speakingIds={voice.speakingIds}
          />
        );
      case "hiding":
        return (
          <HidingPhase
            state={s}
            onHide={game.hide}
            onAutoHide={game.autoHide}
            onValidateHide={game.validateHide}
            speakingIds={voice.speakingIds}
          />
        );
      case "finding":
        return (
          <FindingPhase
            state={s}
            onGuess={game.guess}
            onPreview={game.previewGuess}
            onView={game.syncView}
            onOpenCase={game.openCase}
            onCaseOpened={setCurrentCaseHint} // Сохраняем чит
            onShareCaseHint={game.shareCaseHint}
            onSpellConsumed={game.consumeSpell}
            onSpellsGranted={game.grantSpells}
          />
        );
      case "results":
        // Передаем сохраненный чит в результаты
        return <ResultsPhase state={s} onNext={game.nextRound} caseHint={currentCaseHint} />;
      case "finished":
        return (
          <FinalScores
            state={s}
            onReturnToLobby={game.returnToLobby}
            onRematch={game.rematch}
          />
        );
      default:
        return null;
    }
  }

  return (
    <>
      {renderPhase()}
      {(s.phase === "hiding" || s.phase === "finding") && (
        <RoundStartNotice
          key={s.phase + "-" + s.roundKey}
          round={s.currentRound + 1}
        />
      )}
      <GameMenu
        isGameMaster={s.youAreGameMaster}
        onLeave={game.leave}
        onClose={game.close}
        onForceAdvance={game.forceAdvance}
        canForceAdvance={s.phase === "hiding" || s.phase === "finding"}
        players={s.players}
        youId={s.youId}
        kickVotes={s.kickVotes}
        kickVotesNeeded={s.kickVotesNeeded}
        onVoteKick={game.voteKick}
      />
      <AmbientMusic active={s.phase === "hiding" || s.phase === "finding"} />
      {!game.connected && (
        <div className="reconnect-banner">{t("Reconnecting...")}</div>
      )}
      {s.youAreSpectator && s.phase !== "lobby" && (
        <div className="spectator-banner">
          👀 {t("Spectating")} — {t("You joined mid-game, so you're watching this one. You'll get a seat in the next game.")}
        </div>
      )}

      {inRound && (
        <ReactionBar reactions={reactions.reactions} onSend={reactions.send} />
      )}

      {voiceChatEnabled && (
        <VoiceChat {...voice} myId={s.youId} players={s.players} />
      )}

      {textChatEnabled && (
        <TextChat
          messages={textChat.messages}
          onSend={textChat.send}
          unreadCount={textChat.unreadCount}
          onSetOpen={textChat.setOpen}
          hasVoice={voiceChatEnabled}
        />
      )}
    </>
  );
}