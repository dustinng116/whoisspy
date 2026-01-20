import { Injectable } from '@angular/core';
import { initializeApp } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  update,
  get,
  onValue,
  remove,
  onDisconnect,
} from 'firebase/database';
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
    wordPair: any,
    voteDuration: number = 15,
    initialIndex: number
  ) {
    const roomRef = ref(this.db, `rooms/${roomId}`);

    await set(roomRef, {
      hostId,
      maxPlayers: 8,
      wordPair,
      usedIndices: [initialIndex],
      config: {
        spyCount: 1,
        allowVoteChange: true,
        voteDuration: voteDuration,
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
          id: hostId, // Lưu ID vào object để dễ map
          name: hostName,
          role: null,
          eliminated: false,
          vote: null,
          joinedAt: Date.now(),
          isOnline: true, // [NEW] Trạng thái online
        },
      },
    });

    // [CHANGED] Host rớt mạng -> Chỉ set offline, KHÔNG XÓA PHÒNG
    const playerStatusRef = ref(
      this.db,
      `rooms/${roomId}/players/${hostId}/isOnline`
    );
    onDisconnect(playerStatusRef).set(false);
  }

  // 2. MỚI: CẬP NHẬT SETTINGS
  async updateSettings(roomId: string, config: any) {
    await update(ref(this.db, `rooms/${roomId}/config`), config);
  }

  async joinRoom(
    roomId: string,
    playerId: string,
    name: string
  ): Promise<string> {
    const roomRef = ref(this.db, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);

    if (!roomSnap.exists()) {
      throw new Error('Phòng không tồn tại! Vui lòng kiểm tra lại ID.');
    }

    const room = roomSnap.val();
    const players = room.players || {};

    // 1. TÌM XEM TÊN NÀY ĐÃ TỒN TẠI CHƯA (Case-insensitive)
    const normalize = (str: string) => str.trim().toLowerCase();
    const cleanName = normalize(name);

    // Tìm key (ID) của người chơi có tên trùng
    const existingPlayerId = Object.keys(players).find(
      (key) => normalize(players[key].name) === cleanName
    );

    let finalPlayerId = playerId; // Mặc định là ID mới

    // =========================================================
    // TRƯỜNG HỢP 1: NGƯỜI CŨ QUAY LẠI (RECLAIM)
    // =========================================================
    if (existingPlayerId) {
      // Cho phép vào lại bất kể trạng thái game (Lobby hay Playing)
      finalPlayerId = existingPlayerId;

      // Cập nhật lại trạng thái Online
      await update(ref(this.db, `rooms/${roomId}/players/${finalPlayerId}`), {
        isOnline: true,
      });
    }
    // =========================================================
    // TRƯỜNG HỢP 2: NGƯỜI CHƠI MỚI TINH
    // =========================================================
    else {
      // Nếu là người mới thì phải check điều kiện phòng
      if (room.game.status !== 'lobby') {
        throw new Error('Game đang diễn ra, không thể tham gia mới!');
      }
      if (Object.keys(players).length >= room.maxPlayers) {
        throw new Error('Phòng đã đầy!');
      }

      // Tạo data người chơi mới
      await update(ref(this.db, `rooms/${roomId}/players/${finalPlayerId}`), {
        id: finalPlayerId,
        name,
        role: null,
        eliminated: false,
        vote: null,
        joinedAt: Date.now(),
        isOnline: true, // [NEW]
      });
    }

    // [CHANGED] CÀI ĐẶT ONDISCONNECT: CHỈ SET OFFLINE, KHÔNG XÓA
    // Dù là người mới hay người cũ, rớt mạng là set isOnline = false
    const statusRef = ref(
      this.db,
      `rooms/${roomId}/players/${finalPlayerId}/isOnline`
    );
    onDisconnect(statusRef).set(false);

    return finalPlayerId; // Trả về ID chính thức để Component cập nhật
  }
  async setPlayerOnline(roomId: string, playerId: string) {
    const playerStatusRef = ref(this.db, `rooms/${roomId}/players/${playerId}`);
     
    await update(playerStatusRef, { 
        isOnline: true,
        lastActive: Date.now()  
    });
 
    const statusRef = ref(this.db, `rooms/${roomId}/players/${playerId}/isOnline`);
    await onDisconnect(statusRef).set(false);
  }
  async leaveRoom(roomId: string, playerId: string) {
    const roomRef = ref(this.db, `rooms/${roomId}`);
    
    // 1. Lấy thông tin phòng TRƯỚC KHI xóa người chơi (để biết ai đang là Host)
    const roomSnap = await get(roomRef);
    if (!roomSnap.exists()) return; // Phòng đã bị xóa trước đó
    
    const roomData = roomSnap.val();
    const currentHostId = roomData.hostId;

    // 2. Xóa người chơi này khỏi danh sách
    await remove(ref(this.db, `rooms/${roomId}/players/${playerId}`));

    // 3. Kiểm tra danh sách người chơi còn lại (SAU KHI đã xóa)
    const playersSnap = await get(ref(this.db, `rooms/${roomId}/players`));
    
    // --- TRƯỜNG HỢP A: KHÔNG CÒN AI ---
    if (!playersSnap.exists() || Object.keys(playersSnap.val()).length === 0) {
      console.log('Phòng trống, tiến hành giải tán...');
      await remove(roomRef); // Xóa luôn phòng
    } 
    // --- TRƯỜNG HỢP B: VẪN CÒN NGƯỜI ---
    else {
      const remainingPlayers = playersSnap.val();
      const remainingIds = Object.keys(remainingPlayers);

      // Nếu người vừa thoát CHÍNH LÀ HOST
      if (playerId === currentHostId) {
        // Chọn người kế thừa (Lấy người đầu tiên trong danh sách còn lại)
        // Firebase thường sắp xếp keys theo thứ tự thêm vào, nên đây thường là người vào sớm nhất tiếp theo
        const newHostId = remainingIds[0];
        const newHostName = remainingPlayers[newHostId].name;

        console.log(`👑 Chuyển quyền chủ phòng cho: ${newHostName} (${newHostId})`);
        
        // Cập nhật Host mới lên Firebase
        await update(roomRef, { hostId: newHostId });
      }
    }
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
  async checkGameViability(roomId: string) {
    const roomRef = ref(this.db, `rooms/${roomId}`);
    const roomSnap = await get(roomRef);
    if (!roomSnap.exists()) return;

    const room = roomSnap.val();

    // Chỉ kiểm tra khi game đang diễn ra (playing hoặc voting)
    if (room.game.status !== 'playing' && room.game.status !== 'voting') return;

    const players = room.players || {};
    // Lọc ra những người chưa bị loại VÀ còn đang kết nối (có trong DB)
    const activePlayers = Object.values(players).filter(
      (p: any) => !p.eliminated
    );

    // 1. Kiểm tra số lượng tối thiểu
    // Nếu chỉ còn 1 người (Host) -> Game Over ngay lập tức
    if (activePlayers.length < 2) {
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: 'none', // Không ai thắng
        endReason: 'not_enough_players', // Lý do mới
      });
      return;
    }

    // 2. Kiểm tra lại điều kiện thắng thua theo số lượng MỚI
    // (Ví dụ: 3 người chơi, 1 Spy thoát -> Còn 2 Dân -> Dân thắng ngay)
    const winResult = this.checkWinCondition(players);
    if (winResult) {
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: winResult,
        endReason: 'player_left', // Thắng do đối thủ bỏ cuộc
      });
    }
  }

  async resolveVote(roomId: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();

    // Kiểm tra lại status để tránh chạy 2 lần
    if (room.game.status !== 'voting') return;

    const tally: Record<string, number> = {};

    // Log để debug xem lúc này Server nhận được bao nhiêu phiếu
    console.log('=== BẮT ĐẦU KIỂM PHIẾU ===');

    Object.entries(room.players).forEach(([_, p]: any) => {
      // Chỉ đếm người chơi CHƯA BỊ LOẠI và ĐÃ VOTE
      if (!p.eliminated && p.vote) {
        tally[p.vote] = (tally[p.vote] || 0) + 1;
      }
    });

    console.log('Kết quả kiểm phiếu:', tally);

    // Sắp xếp giảm dần (Người nhiều phiếu nhất đứng đầu)
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);

    let isDraw = false;

    // TRƯỜNG HỢP 1: Không ai vote cả -> HÒA
    if (sorted.length === 0) {
      isDraw = true;
    }
    // TRƯỜNG HỢP 2: Có ít nhất 2 người được vote, và số phiếu bằng nhau -> HÒA
    // Ví dụ: A(2 phiếu), B(2 phiếu) => sorted[0][1] == 2, sorted[1][1] == 2
    else if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) {
      isDraw = true;
    }

    if (isDraw) {
      console.log('-> KẾT QUẢ: HÒA');
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'draw',
        revealedPlayer: null,
      });
      return;
    }

    // XỬ LÝ LOẠI NGƯỜI (Người đứng đầu mảng sorted)
    const eliminatedId = sorted[0][0];
    const votesCount = sorted[0][1];

    console.log(`-> LOẠI NGƯỜI CHƠI: ${eliminatedId} với ${votesCount} phiếu`);

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
  async backToLobby(roomId: string, newPair: any, updatedUsedIndices: number[]) {
    const updates: any = {};

    // 1. Reset trạng thái Game
    updates[`rooms/${roomId}/game`] = {
      status: 'lobby',
      winner: null,
      endReason: null,
      heroId: null,
      revealedPlayer: null,
      startedAt: null,
      voteStartedAt: null
    };

    // 2. Cập nhật từ khóa mới VÀ Danh sách đã dùng
    updates[`rooms/${roomId}/wordPair`] = newPair;
    updates[`rooms/${roomId}/usedIndices`] = updatedUsedIndices; // [NEW]

    // 3. Reset trạng thái người chơi & Dọn dẹp Offline
    const roomSnap = await get(ref(this.db, `rooms/${roomId}/players`));
    if (roomSnap.exists()) {
      const players = roomSnap.val();
      Object.keys(players).forEach((pid) => {
        const p = players[pid];
        if (p.isOnline === false) {
            updates[`rooms/${roomId}/players/${pid}`] = null;
        } else {
            updates[`rooms/${roomId}/players/${pid}/role`] = null;
            updates[`rooms/${roomId}/players/${pid}/vote`] = null;
            updates[`rooms/${roomId}/players/${pid}/eliminated`] = false;
        }
      });
    }

    await update(ref(this.db), updates);
  }
  async guessWord(roomId: string, playerId: string, guessWord: string) {
    const room = (await get(ref(this.db, `rooms/${roomId}`))).val();
    const player = room.players[playerId];
    const playerRole = player.role; // 'spy' hoặc 'villian'

    // 1. Xác định từ khóa mục tiêu (Target Word)
    // Nếu mình là Spy -> Phải đoán từ của Villian
    // Nếu mình là Villian -> Phải đoán từ của Spy
    let targetWord = '';
    if (playerRole === 'spy') {
      targetWord = room.wordPair.villian;
    } else {
      targetWord = room.wordPair.spy;
    }

    const isCorrect =
      guessWord.trim().toLowerCase() === targetWord.toLowerCase();

    // 2. Xử lý kết quả
    if (isCorrect) {
      // --- ĐOÁN ĐÚNG ---
      // Người đoán thắng -> Phe của người đó thắng
      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: playerRole, // 'spy' hoặc 'villian'
        endReason: 'guessed_correct',
        heroId: playerId, // Lưu ID người hùng đã đoán đúng
      });
    } else {
      // --- ĐOÁN SAI ---
      // Người đoán thua -> Phe ĐỐI PHƯƠNG thắng
      const winnerRole = playerRole === 'spy' ? 'villian' : 'spy';

      await update(ref(this.db, `rooms/${roomId}/game`), {
        status: 'game_over',
        winner: winnerRole,
        endReason: 'guessed_wrong',
        heroId: playerId, // Lưu ID "tội đồ" đã đoán sai
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
      // Chỉ đếm người CHƯA bị loại
      if (!p.eliminated) {
        if (p.role === 'spy') spyCount++;
        else villianCount++;
      }
    });

    if (spyCount === 0) return 'villian'; // Hết Spy -> Dân thắng
    if (spyCount >= villianCount) return 'spy'; // Spy áp đảo -> Spy thắng

    return null; // Game tiếp tục
  }

  async endReveal(roomId: string) {
    // Fix looping bug: Ensure revealedPlayer is cleared
    await update(ref(this.db, `rooms/${roomId}/game`), {
      status: 'discussion', // or 'playing'
      revealedPlayer: null,
    });
  }

  listenRoom(roomId: string, callback: (room: any) => void) {
    const roomRef = ref(this.db, `rooms/${roomId}`);
     
    const unsubscribe = onValue(roomRef, (snapshot) => {
      callback(snapshot.val());
    });
 
    const connectedRef = ref(this.db, '.info/connected');
    onValue(connectedRef, (snap) => {
      if (snap.val() === true) {
        // Mạng đã kết nối -> Báo ngay cho server biết mình đang Online
        // Lưu ý: Cần ID user, ở đây ta giả định logic này được gọi ở Component
        // Nhưng để đơn giản, ta sẽ xử lý ở Component (xem bên dưới)
      }
    });

    return unsubscribe;
  }

  updateAvatar(roomId: string, playerId: string, avatarImage: string) {
    return update(ref(this.db, `rooms/${roomId}/players/${playerId}`), {
      avatar: avatarImage,
    });
  }
}
