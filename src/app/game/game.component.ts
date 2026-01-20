import { Component, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameService } from './game.service';
import QRCode from 'qrcode';
import { ActivatedRoute } from '@angular/router';
import wordData from './dataSource.json';

interface Player {
  id: string;
  name: string;
  role: 'spy' | 'villian' | null;
  joinedAt: number;
  eliminated?: boolean;
  vote?: string | null;
  avatar?: string;
}
@Component({
  selector: 'app-game',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.scss'],
})
export class GameComponent {
  readonly MAX_PLAYERS = 12;
  readonly VOTE_TIME = 15000;
  private unsubRoom: any = null;
  selectedTime = signal(15);
  timeOptions = [15, 30, 60];
  // State
  viewMode = signal<'home' | 'join_input'>('home');
  roomId = signal<string | null>(null);
  playerName = signal(localStorage.getItem('spy_username') || '');
  playerId: any = crypto.randomUUID();
  joined = signal(false);
  room = signal<any>(null);

  // Gameplay Flags
  showWord = signal(false);
  hasSeenRole = false;

  // Modals
  showResultModal = signal(false); // For Elimination / Game Over
  showDrawModal = signal(false); // For Draw
  isSpyGuessing = signal(false); // For Spy Input
  spyGuessInput = signal('');
  showSettingsModal = signal(false);
  showAvatarModal = signal(false);
  previewAvatar = signal<string | null>(null);

  // Timer & Vote
  voteCountdown = signal(0);
  selectedVoteId = signal<string | null>(null);

  // UI Helpers
  qrCodeUrl = signal<string | null>(null);
  joinRoomInput = signal('');
  showQrModal = signal(false);

  tempSpyCount = signal(1);
  tempAllowVoteChange = signal(true);
  tempVoteDuration = signal(15);

  currentSpyCount = computed(() => this.room()?.config?.spyCount || 1);
  minRequiredPlayers = computed(() => this.currentSpyCount() * 2 + 1);
  tempMinRequired = computed(() => this.tempSpyCount() * 2 + 1);
  viewingUser = signal<any>(null);

  isNameError = signal(false);
  isRoomError = signal(false);

  showErrorModal = signal(false);
  errorMessage = signal('');

  isGuessing = signal(false);
  guessInput = signal('');
  emoji = '';
  isWordVisible = signal(false);

  isReviewingKeyword = signal(false);

  showExitConfirm = signal(false);

  connectionStatus = signal<'connected' | 'connecting' | 'offline'>(
    'connected'
  );
  showToast = signal(false);
  private heartbeatInterval: any;
  readonly AVATAR_LIST = [
    '1.jpg',
    '2.jpg',
    '3.jpg',
    '4.jpg',
    '5.jpg',
    '6.jpg',
    '7.jpg',
    '8.jpg',
    '9.jpg',
    '10.jpg',
    '11.png',
    '12.jpg',
    '13.jpg',
    '14.jpg',
    '15.png',
    '16.jpg',
    '17.jpg',
    '18.jpg',
    '19.jpg',
    '20.jpg',
    '21.jpg',
    '22.jpg',
  ];
  randomEmoji(): string {
    const emojis = [
      '😎',
      '😂',
      '🤔',
      '🥳',
      '🔥',
      '✨',
      '🚀',
      '🎉',
      '💡',
      '🤯',
      '👀',
      '👍',
      '❤️',
    ];

    const index = Math.floor(Math.random() * emojis.length);
    return emojis[index];
  }
  constructor(private game: GameService, private route: ActivatedRoute) {
    // 1. Timer Vote Logic
    effect(() => {
      const g = this.room()?.game;
      if (g?.status !== 'voting') {
        this.selectedVoteId.set(null);
        return;
      }
      const DURATION_SEC = this.room()?.config?.voteDuration || 30;
      const DURATION_MS = DURATION_SEC * 1000;

      const tick = () => {
        if (!g.voteStartedAt) {
          return;
        }

        const now = Date.now();
        const elapsed = now - g.voteStartedAt;
        if (elapsed > DURATION_MS + 5000) {
          return;
        }
        const remain = Math.max(0, DURATION_MS - elapsed);
        const seconds = Math.ceil(remain / 1000);

        if (this.voteCountdown() !== seconds) {
          this.voteCountdown.set(seconds);
        }
        if (remain <= 0) {
          clearInterval(i);
          if (this.isHost()) {
            setTimeout(() => {
              this.game.resolveVote(this.roomId()!);
            }, 2000);
          }
        }
      };
      tick();
      const i = setInterval(tick, 1000);
      return () => clearInterval(i);
    });

    // 2. Show Role Card Logic
    effect(() => {
      const status = this.room()?.game?.status;
      if (status === 'playing' && !this.hasSeenRole) {
        this.showWord.set(true);
      }
    });

    // 3. Handle Game Status Changes (FIXED HERE)
    effect(() => {
      const status = this.room()?.game?.status;

      // --- LOGIC MỚI: KHI VỀ LOBBY THÌ RESET HẾT UI ---
      if (status === 'lobby') {
        this.showResultModal.set(false);
        this.showDrawModal.set(false);
        this.isSpyGuessing.set(false);
        this.showWord.set(false); // Đóng thẻ bài nếu đang mở
        this.hasSeenRole = false; // Reset flag để ván sau hiện lại bài
        this.voteCountdown.set(0);
        this.selectedVoteId.set(null);
        return; // Thoát luôn, không chạy logic dưới
      }

      // --- Logic hiển thị Modal Kết quả / Hòa ---
      if (status === 'reveal' || status === 'game_over') {
        this.showResultModal.set(true);
        if (status === 'reveal') {
          setTimeout(() => this.closeResultModal(), 5000);
        }
      } else if (status === 'draw') {
        this.showDrawModal.set(true);
        setTimeout(() => this.closeDrawModal(), 3000);
      }
    });

    this.route.queryParams.subscribe((params) => {
      const roomFromUrl = params['room'];

      if (roomFromUrl) {
        this.joinRoomInput.set(roomFromUrl);
        this.qrCodeUrl.set(null);
        this.viewMode.set('join_input');
      }
    });
    this.startHeartbeat();
  }
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      // Chỉ chạy khi đã vào phòng
      if (!this.joined() || !this.roomId() || !this.room()) return;

      const myPlayer = this.room().players[this.playerId];

      // Nếu không tìm thấy mình trong phòng (có thể bị xóa) -> Bỏ qua
      if (!myPlayer) return;

      // 1. Kiểm tra trạng thái mạng của trình duyệt HOẶC trạng thái trong DB
      const isBrowserOffline = !navigator.onLine;
      const isDbOffline = myPlayer.isOnline === false;

      // NẾU PHÁT HIỆN SỰ CỐ (Mất mạng hoặc DB ghi nhận Offline)
      if (isBrowserOffline || isDbOffline) {
        // Cập nhật trạng thái UI
        if (this.connectionStatus() !== 'connecting') {
          this.connectionStatus.set('connecting');
          this.showToast.set(true); // Hiện Toast Spinner
        }

        // Gọi API để cứu vãn (Try to connect)
        // Chỉ gọi API nếu mạng trình duyệt còn sống (để tránh lỗi network error liên tục)
        if (!isBrowserOffline) {
          console.log('🔄 Đang thử kết nối lại...');
          this.game
            .setPlayerOnline(this.roomId()!, this.playerId)
            .catch((err) => {
              // Kệ lỗi, lần sau thử tiếp
            });
        }
      }

      // NẾU MỌI THỨ ĐÃ ỔN (Đang từ connecting -> connected)
      else if (this.connectionStatus() === 'connecting') {
        this.connectionStatus.set('connected');
        this.showToast.set(true); // Hiện Toast Xanh

        // Tự tắt Toast sau 3s
        setTimeout(() => {
          // Chỉ tắt nếu vẫn đang là connected (tránh trường hợp vừa xanh lại đỏ ngay)
          if (this.connectionStatus() === 'connected') {
            this.showToast.set(false);
          }
        }, 3000);
      }
    }, 3000); // Chạy mỗi 3s
  }
  ngOnDestroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
  }
  toggleWordVisibility() {
    this.isWordVisible.update((v) => !v);
  }

  toggleReviewKeyword() {
    this.isReviewingKeyword.update((v) => !v);
  }
  // ===== ACTIONS =====
  openSettings() {
    const config = this.room()?.config || {
      spyCount: 1,
      allowVoteChange: true,
      voteDuration: 15,
    };

    this.tempSpyCount.set(config.spyCount);
    this.tempAllowVoteChange.set(config.allowVoteChange);
    this.tempVoteDuration.set(config.voteDuration || 15);

    this.showSettingsModal.set(true);
  }

  closeSettings() {
    this.showSettingsModal.set(false);
  }

  async saveSettings() {
    if (!this.roomId()) return;

    const newConfig = {
      spyCount: Number(this.tempSpyCount()),
      allowVoteChange: this.tempAllowVoteChange(),
      voteDuration: this.tempVoteDuration(),
    };

    await this.game.updateSettings(this.roomId()!, newConfig);
    this.closeSettings();
  }
  // SPY GUESS ACTIONS
  openSpyGuess() {
    this.spyGuessInput.set('');
    this.isSpyGuessing.set(true);
  }

  closeSpyGuess() {
    this.isSpyGuessing.set(false);
  }
  openGuessModal() {
    this.guessInput.set('');
    this.isGuessing.set(true);
  }

  closeGuessModal() {
    this.isGuessing.set(false);
  }
  async submitGuess() {
    if (!this.guessInput()) return;
    // Gọi hàm service mới
    await this.game.guessWord(this.roomId()!, this.playerId, this.guessInput());
    this.closeGuessModal();
  }
  heroId = computed(() => this.room()?.game?.heroId);
  heroName = computed(() => {
    const id = this.heroId();
    return id ? this.room()?.players[id]?.name : '';
  });
  // MODAL ACTIONS
  closeResultModal() {
    this.showResultModal.set(false);

    // Check if Game Over -> Maybe reset game or go to lobby (Logic dependent on req)
    // If just reveal -> Continue game
    if (this.room()?.game?.status === 'reveal') {
      this.game.endReveal(this.roomId()!);
    } else if (this.room()?.game?.status === 'game_over') {
      // Stay on screen or reset? For now, we leave the user to decide (e.g. create new room)
      // Or we could trigger a lobby reset here.
    }
  }

  closeDrawModal() {
    this.showDrawModal.set(false);
    // Return to discussion
    this.game.endReveal(this.roomId()!);
  }

  private generateRoomId(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
  }
  async copyRoomId() {
    if (this.roomId()) await navigator.clipboard.writeText(this.roomId()!);
  }
  onlyNumberInput(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 8);
    this.joinRoomInput.set(input.value);
  }
  async generateQrCode() {
    if (!this.roomId()) return;
    try {
      const qr = await QRCode.toDataURL(
        `${location.origin}?room=${this.roomId()}`,
        { margin: 2, width: 300 }
      );
      this.qrCodeUrl.set(qr);
    } catch (e) {}
  }
  toggleQr(show: boolean) {
    if (show && !this.qrCodeUrl()) this.generateQrCode();
    this.showQrModal.set(show);
  }
  getInitials(name: string) {
    return name ? name.substring(0, 2).toUpperCase() : '??';
  }
  private pickUniqueWordIndex(): { index: number; nextUsedIndices: number[] } {
    const totalWords = wordData.length;
    const currentUsed = this.room()?.usedIndices || [];

    let availableIndices: number[] = [];
    for (let i = 0; i < totalWords; i++) {
      if (!currentUsed.includes(i)) {
        availableIndices.push(i);
      }
    }
    if (availableIndices.length === 0) {
      console.log('Đã chơi hết bộ từ! Reset lại từ đầu.');
      availableIndices = Array.from({ length: totalWords }, (_, i) => i);
    }

    const randomIndex = Math.floor(Math.random() * availableIndices.length);
    const selectedIndex = availableIndices[randomIndex];

    let nextUsedIndices: number[] = [];

    if (availableIndices.length === totalWords) {
      nextUsedIndices = [selectedIndex]; // Reset cycle
    } else {
      nextUsedIndices = [...currentUsed, selectedIndex]; // Append
    }

    return { index: selectedIndex, nextUsedIndices };
  }
  async createRoom() {
    if (!this.playerName().trim()) {
      this.isNameError.set(true);
      return;
    }
    localStorage.setItem('spy_username', this.playerName());
    const id = this.generateRoomId();
    this.roomId.set(id);
    const initialIndex = Math.floor(Math.random() * wordData.length);
    const pair = wordData[initialIndex];
    this.qrCodeUrl.set(null);
    await this.game.createRoom(
      id,
      this.playerId,
      this.playerName(),
      pair,
      this.selectedTime(),
      initialIndex
    );
    this.joined.set(true);
    this.listen();
  }
  async joinRoom() {
    let isValid = true;

    if (!this.playerName().trim()) {
      this.isNameError.set(true);
      isValid = false;
    }
    if (this.joinRoomInput().length !== 8) {
      this.isRoomError.set(true);
      isValid = false;
    }

    if (!isValid) return;
    localStorage.setItem('spy_username', this.playerName());
    try {
      const realId = await this.game.joinRoom(
        this.joinRoomInput(),
        this.playerId,
        this.playerName()
      );

      this.playerId = realId;

      this.roomId.set(this.joinRoomInput());
      this.joined.set(true);
      this.listen();
    } catch (err: any) {
      this.errorMessage.set(err.message || 'Có lỗi xảy ra, vui lòng thử lại.');
      this.showErrorModal.set(true);
    }
  }
  openExitConfirm() {
    this.showExitConfirm.set(true);
  }

  // [NEW] Đóng Modal
  closeExitConfirm() {
    this.showExitConfirm.set(false);
  }

  // [NEW] Xác nhận thoát (Gọi hàm exitGame cũ)
  confirmExit() {
    this.exitGame(); // Hàm này đã có sẵn logic xử lý Host/User ở các bước trước
    this.closeExitConfirm();
  }
  // Hàm đóng modal lỗi
  closeErrorModal() {
    this.showErrorModal.set(false);
    this.errorMessage.set('');
  }
  onNameInput(val: string) {
    this.playerName.set(val);
    if (val) this.isNameError.set(false);
  }

  onRoomInput(event: Event) {
    this.onlyNumberInput(event);
    this.isRoomError.set(false);
  }
  startGame() {
    this.game.startGame(this.roomId()!, this.playerId);
  }
  startVoting() {
    this.game.startVoting(this.roomId()!);
  }
  listen() {
    if (this.unsubRoom) this.unsubRoom();

    this.unsubRoom = this.game.listenRoom(this.roomId()!, (data) => {
      if (!data) {
        this.forceExit();
        return;
      }
      if (data.players && !data.players[this.playerId]) {
        this.errorMessage.set('Bạn đã thoát ra khỏi phòng!');
        this.showErrorModal.set(true);

        if (this.unsubRoom) {
          this.unsubRoom();
          this.unsubRoom = null;
        }
        this.resetLocalState();
        return;
      }
      const status = data.game?.status;
      if (
        this.playerId === data.hostId &&
        (status === 'playing' || status === 'voting')
      ) {
        // Kiểm tra xem có cần End Game ngay không?
        // (Gọi mỗi khi data thay đổi đảm bảo tính realtime cao nhất)
        this.game.checkGameViability(this.roomId()!);
      }
      // Cập nhật data bình thường
      this.room.set(data);
    });
  }
  async exitGame() {
    const currentRoomId = this.roomId();
    const currentPlayerId = this.playerId;

    if (!currentRoomId) return;

    if (this.unsubRoom) {
      this.unsubRoom();
      this.unsubRoom = null;
    }

    try {
      await this.game.leaveRoom(currentRoomId, currentPlayerId);
    } catch (e) {
      console.error('Lỗi khi thoát phòng:', e);
    }

    this.resetLocalState();
  }
  forceExit() {
    this.errorMessage.set('Chủ phòng đã giải tán phòng chơi!');
    this.showErrorModal.set(true);

    this.resetLocalState();
  }
  private resetLocalState() {
    if (this.unsubRoom) {
      this.unsubRoom();
      this.unsubRoom = null;
    }

    this.joined.set(false);
    this.roomId.set(null);
    this.room.set(null);

    // [FIX] Reset sạch Input và QR Code
    this.joinRoomInput.set('');
    this.qrCodeUrl.set(null);

    // Reset các modal...
    this.showResultModal.set(false);
    this.showDrawModal.set(false);
    this.showSettingsModal.set(false);
    this.isSpyGuessing.set(false);
    this.showWord.set(false);
    this.hasSeenRole = false;
    this.voteCountdown.set(0);
    this.isWordVisible.set(false);
    this.isReviewingKeyword.set(false);

    this.viewMode.set('home');
  }
  selectForVote(id: string) {
    if (this.room()?.game?.status !== 'voting') return;
    const p = this.room()?.players[id];
    if (p.eliminated || id === this.playerId) return;

    const myCurrentVote = this.room()?.players[this.playerId]?.vote;
    const allowChange = this.room()?.config?.allowVoteChange;

    if (!allowChange && myCurrentVote) {
      alert('Chế độ này không cho phép thay đổi phiếu bầu!');
      return;
    }

    this.selectedVoteId.set(id);
  }

  async confirmVote() {
    if (this.selectedVoteId()) {
      try {
        await this.game.vote(
          this.roomId()!,
          this.playerId,
          this.selectedVoteId()!
        );
      } catch (error) {
        alert('Lỗi: Không thể thay đổi phiếu bầu.');
      }
    }
  }
  showJoinInput() {
    if (!this.playerName().trim()) {
      this.isNameError.set(true);
      return;
    }
    this.viewMode.set('join_input');
  }
  acknowledgeRole() {
    this.hasSeenRole = true;
    this.showWord.set(false);
  }
  async backToLobby() {
    if (this.isHost()) {
      const { index, nextUsedIndices } = this.pickUniqueWordIndex();
      const newPair = wordData[index];
      await this.game.backToLobby(this.roomId()!, newPair, nextUsedIndices);
    }
    this.showResultModal.set(false);
  }
  // ===== COMPUTED =====
  // Game State Logic
  status = computed(() => this.room()?.game?.status || 'lobby');
  isLobby = computed(() => this.status() === 'lobby');
  isVoting = computed(() => this.status() === 'voting');
  isDiscussion = computed(
    () =>
      (this.status() === 'playing' || this.status() === 'discussion') &&
      !this.showWord()
  );
  isGameOver = computed(() => this.status() === 'game_over');

  // Role Logic
  isHost = computed(() => this.room()?.hostId === this.playerId);
  myRoleRaw = computed(() => this.room()?.players?.[this.playerId]?.role);
  isSpy = computed(() => this.myRoleRaw() === 'spy'); // Check if current user is Spy
  isEliminated = computed(
    () => this.room()?.players?.[this.playerId]?.eliminated
  );

  myWord = computed(() => {
    const role = this.myRoleRaw();
    return role ? this.room()?.wordPair?.[role] : '???';
  });

  // Winner Logic
  winner = computed(() => {
    this.emoji = this.randomEmoji();
    return this.room()?.game?.winner;
  });

  // Helpers
  playerCount = computed(() => Object.keys(this.room()?.players || {}).length);
  playersSlots = computed(() => {
    const playersMap = this.room()?.players ?? {};
    const slots = Object.entries(playersMap).map(([id, p]: any) => ({
      id,
      ...p,
    }));
    while (slots.length < this.MAX_PLAYERS) slots.push(null);
    return slots;
  });

  voteCounts = computed(() => {
    const counts: Record<string, number> = {};
    Object.values(this.room()?.players || {}).forEach((p: any) => {
      if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
    });
    return counts;
  });

  endReason = computed(() => this.room()?.game?.endReason);

  spiesList = computed(() => {
    const players = this.room()?.players || {};
    return (Object.values(players) as Player[]).filter((p) => p.role === 'spy');
  });
  getVoteDots(playerId: string): number[] {
    return Array(this.voteCounts()[playerId] || 0).fill(0);
  }

  getAvatarColor(name: string) {
    const colors = [
      '#e0f7fa',
      '#f3e5f5',
      '#fff3e0',
      '#e8f5e9',
      '#e3f2fd',
      '#fce4ec',
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++)
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  selectAvatar(img: string) {
    if (!this.roomId()) return;
    this.game.updateAvatar(this.roomId()!, this.playerId, img);
    this.showAvatarModal.set(false);
  }

  onAvatarClick(player: any) {
    // TRƯỜNG HỢP 1: Click vào chính mình (khi ở Lobby) -> Mở modal Đổi Avatar
    if (player.id === this.playerId) {
      if (this.isLobby()) {
        this.previewAvatar.set(null);
        this.showAvatarModal.set(true);
      }
      return;
    }

    // TRƯỜNG HỢP 2: Click vào người khác -> Mở modal Xem Avatar
    // (Cho phép xem ở mọi trạng thái game, không chỉ Lobby)
    this.viewingUser.set(player);
  }
  closeViewUser() {
    this.viewingUser.set(null);
  }
  // 2. Bấm vào hình nhỏ -> Chuyển sang chế độ xem trước
  openPreview(img: string) {
    this.previewAvatar.set(img);
  }

  // 3. Quay lại danh sách
  backToList() {
    this.previewAvatar.set(null);
  }

  // 4. Xác nhận chọn hình đang xem
  confirmAvatar() {
    const img = this.previewAvatar();
    if (img && this.roomId()) {
      this.game.updateAvatar(this.roomId()!, this.playerId, img);
      this.showAvatarModal.set(false); // Đóng modal
      this.previewAvatar.set(null); // Reset
    }
  }
}
