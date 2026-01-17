import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, update, get, onValue } from 'firebase/database';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class GameService {
  private db;

  constructor() {
    const app = initializeApp(environment.firebaseConfig);
    this.db = getDatabase(app);
  }

  async createRoom(
    roomId: string,
    hostId: string,
    hostName: string,
    wordPair: any
  ) {
    await set(ref(this.db, `rooms/${roomId}`), {
      hostId,
      maxPlayers: 8,
      wordPair,
      // CONFIG MẶC ĐỊNH
      config: {
        spyCount: 1, // 1 Điệp viên
        allowVoteChange: true, // Được phép đổi vote
      },
      game: {
        status: 'lobby',
        startedAt: null,
        voteStartedAt: null,
        revealedPlayer: null,
        winner: null,
      },
      players: {
        [hostId]: {
          name: hostName,
          role: null,
          eliminated: false,
          vote: null,
          joinedAt: Date.now(),
        },
      },
    });
  }

  // 2. MỚI: CẬP NHẬT SETTINGS
  async updateSettings(roomId: string, config: any) {
    await update(ref(this.db, `rooms/${roomId}/config`), config);
  }

  async joinRoom(roomId: string, playerId: string, name: string) {
    const roomSnap = await get(ref(this.db, `rooms/${roomId}`));
    const room = roomSnap.val();
    if (!room || room.game.status !== 'lobby') return;

    const count = Object.keys(room.players || {}).length;
    if (count >= room.maxPlayers) return;

    await update(ref(this.db, `rooms/${roomId}/players/${playerId}`), {
      name,
      role: null,
      eliminated: false,
      vote: null,
      joinedAt: Date.now(),
    });
  }

  async startGame(roomId: string, hostId: string) {
    const roomRef = ref(this.db, `rooms/${roomId}`);
    const room = (await get(roomRef)).val();
    if (room.hostId !== hostId) return;

    const ids = Object.keys(room.players);
    const config = room.config || { spyCount: 1 };

    // Thuật toán chọn ngẫu nhiên N điệp viên
    const shuffled = ids.sort(() => 0.5 - Math.random());
    const spies = shuffled.slice(0, config.spyCount);

    const updates: any = {};

    for (const id of ids) {
      const isSpy = spies.includes(id);
      updates[`rooms/${roomId}/players/${id}/role`] = isSpy ? 'spy' : 'villian';
      updates[`rooms/${roomId}/players/${id}/eliminated`] = false;
      updates[`rooms/${roomId}/players/${id}/vote`] = null;
    }

    updates[`rooms/${roomId}/game/status`] = 'playing';
    updates[`rooms/${roomId}/game/startedAt`] = Date.now();
    updates[`rooms/${roomId}/game/winner`] = null;
    updates[`rooms/${roomId}/game/revealedPlayer`] = null;

    await update(ref(this.db), updates);
  }

  async startVoting(roomId: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();
    const updates: any = {};

    Object.keys(room.players).forEach((pid) => {
      updates[`rooms/${roomId}/players/${pid}/vote`] = null;
    });

    updates[`rooms/${roomId}/game/status`] = 'voting';
    updates[`rooms/${roomId}/game/voteStartedAt`] = Date.now();

    await update(ref(this.db), updates);
  }

  async vote(roomId: string, voterId: string, targetId: string) {
    const roomSnap = await get(ref(this.db, `rooms/${roomId}`));
    const room = roomSnap.val();

    // Nếu config không cho đổi vote, và người chơi đã vote rồi -> Chặn
    if (room.config && room.config.allowVoteChange === false) {
      if (room.players[voterId].vote) {
        throw new Error('Không được phép thay đổi vote!');
      }
    }

    return update(ref(this.db, `rooms/${roomId}/players/${voterId}`), {
      vote: targetId,
    });
  }

  async resolveVote(roomId: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();
    if (room.game.status !== 'voting') return;

    const tally: Record<string, number> = {};
    Object.entries(room.players).forEach(([_, p]: any) => {
      if (!p.eliminated && p.vote) {
        tally[p.vote] = (tally[p.vote] || 0) + 1;
      }
    });

    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    let isDraw = false;
    if (sorted.length === 0) {
      isDraw = true;
    } else if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      isDraw = true;
    }

    if (isDraw) {
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'draw',
        revealedPlayer: null,
      });
      return;
    }

    // XỬ LÝ LOẠI NGƯỜI
    const eliminatedId = sorted[0][0];

    // 1. Cập nhật trạng thái bị loại trong DB
    await update(ref(this.db, `rooms/${roomId}/players/${eliminatedId}`), {
      eliminated: true,
    });

    // 2. Kiểm tra điều kiện thắng thua ngay lập tức
    // Cập nhật tạm thời object room để check logic
    room.players[eliminatedId].eliminated = true;
    const winResult = this.checkWinCondition(room.players);

    if (winResult) {
      // Có người thắng
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: winResult,
        revealedPlayer: {
          id: eliminatedId,
          role: room.players[eliminatedId].role,
        },
      });
    } else {
      // Game tiếp tục -> Reveal người bị loại
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'reveal',
        revealedPlayer: {
          id: eliminatedId,
          role: room.players[eliminatedId].role,
        },
      });
    }
  }

  // --- NEW: SPY GUESS LOGIC ---
  async spyGuessWord(roomId: string, playerId: string, word: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();
    const villianWord = room.wordPair.villian;

    if (word.trim().toLowerCase() === villianWord.toLowerCase()) {
      // 1. SPY ĐOÁN ĐÚNG -> SPY THẮNG
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: 'spy',
        endReason: 'spy_guessed_correct', // Thêm lý do để UI hiển thị
      });
    } else {
      // 2. SPY ĐOÁN SAI -> DÂN (VILLIAN) THẮNG NGAY LẬP TỨC
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: 'villian',
        endReason: 'spy_guessed_wrong', // Lý do thua: Đoán sai
        wrongGuessPayload: {
          playerId: playerId,
          word: word,
        },
      });
    }
  }
  async resetRoom(roomId: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();
    const updates: any = {};

    // 1. Reset trạng thái Game về Lobby
    updates[`rooms/${roomId}/game`] = {
      status: 'lobby',
      startedAt: null,
      voteStartedAt: null,
      revealedPlayer: null,
      winner: null,
      endReason: null,
    };

    // 2. Reset thông tin người chơi (Xóa Role, Vote, Trạng thái loại)
    if (room.players) {
      Object.keys(room.players).forEach((pid) => {
        updates[`rooms/${roomId}/players/${pid}/role`] = null;
        updates[`rooms/${roomId}/players/${pid}/eliminated`] = false;
        updates[`rooms/${roomId}/players/${pid}/vote`] = null;
      });
    }

    await update(ref(this.db), updates);
  }
  // --- HELPER: WIN LOGIC ---
  // - number of spy = number of villian -> Spy win
  // - number of spy = 0 -> villian win
  private checkWinCondition(players: any): 'spy' | 'villian' | null {
    let spyCount = 0;
    let villianCount = 0;

    Object.values(players).forEach((p: any) => {
      if (!p.eliminated) {
        if (p.role === 'spy') spyCount++;
        else villianCount++;
      }
    });

    if (spyCount === 0) return 'villian';
    if (spyCount >= villianCount) return 'spy';

    return null; // Continue game
  }

  async endReveal(roomId: string) {
    // Fix looping bug: Ensure revealedPlayer is cleared
    await update(ref(this.db, `rooms/${roomId}/game`), {
      status: 'discussion', // or 'playing'
      revealedPlayer: null,
    });
  }

  listenRoom(roomId: string, cb: (data: any) => void) {
    return onValue(ref(this.db, `rooms/${roomId}`), (snap) => cb(snap.val()));
  }

  updateAvatar(roomId: string, playerId: string, avatarImage: string) {
    return update(ref(this.db, `rooms/${roomId}/players/${playerId}`), {
      avatar: avatarImage,
    });
  }
}
