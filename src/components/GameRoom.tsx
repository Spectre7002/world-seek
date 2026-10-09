"use client";

import { useGame } from "@/lib/useGame";
import { useTextChat } from "@/lib/useTextChat";
import { useVoiceChat } from "@/lib/useVoiceChat";
import BudgetClosed from "./BudgetClosed";
import GameMenu from "./GameMenu";
import JoinForm from "./JoinForm";
import Lobby from "./Lobby";
import HidingPhase from "./HidingPhase";
import FindingPhase from "./FindingPhase";
import ResultsPhase from "./ResultsPhase";
import FinalScores from "./FinalScores";
import TextChat from "./TextChat";
import VoiceChat from "./VoiceChat";
import RoundStartNotice from "./RoundStartNotice";
import AmbientMusic from "./AmbientMusic";
import { useLanguage } from "@/lib/language";

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

  if (game.budgetBlocked) {
    return <BudgetClosed inGame />;
  }

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
          />
        );
      case "results":
        return <ResultsPhase state={s} onNext={game.nextRound} />;
      case "finished":
        return <FinalScores state={s} onReturnToLobby={game.returnToLobby} />;
      default:
        return null;
    }
  }

  return (
    <>
      {renderPhase()}
      {(s.phase === "hiding" || s.phase === "finding") && (
        <RoundStartNotice
          key={s.phase + "-" + s.currentRound}
          round={s.currentRound + 1}
        />
      )}
      <GameMenu
        isGameMaster={s.youAreGameMaster}
        onLeave={game.leave}
        onClose={game.close}
      />
      <AmbientMusic active={s.phase === "hiding" || s.phase === "finding"} />
      {!game.connected && (
        <div className="reconnect-banner">{t("Reconnecting…")}</div>
      )}

      {voiceChatEnabled && (
        <VoiceChat {...voice} myId={s.youId} />
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