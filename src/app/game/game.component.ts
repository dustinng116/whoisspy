import { Component, signal, computed, effect, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import QRCode from 'qrcode';
import { GameService } from './game.service';
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
export class GameComponent implements OnDestroy {
  // ==========================================
  // 1. CONFIG & CONSTANTS
  // ==========================================
  readonly MAX_PLAYERS = 12;
  readonly VOTE_TIME = 15000;
  timeOptions = [15, 30, 60];
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

  // ==========================================
  // 2. STATE SIGNALS
  // ==========================================
  // Connection & Room
  roomId = signal<string | null>(null);
  playerName = signal(localStorage.getItem('spy_username') || '');
  playerId: string = crypto.randomUUID();
  joined = signal(false);
  room = signal<any>(null);
  viewMode = signal<'home' | 'join_input'>('home');
  connectionStatus = signal<'connected' | 'connecting' | 'offline'>(
    'connected'
  );

  // Gameplay State
  showWord = signal(false);
  hasSeenRole = false;
  voteCountdown = signal(0);
  selectedVoteId = signal<string | null>(null);
  isWordVisible = signal(false);
  isReviewingKeyword = signal(false);
  isSpyGuessing = signal(false);
  isGuessing = signal(false);

  // Inputs & Validation
  joinRoomInput = signal('');
  guessInput = signal('');
  spyGuessInput = signal('');
  isNameError = signal(false);
  isRoomError = signal(false);
  isCopied = signal(false);

  // Settings State (Temp)
  selectedTime = signal(15);
  tempSpyCount = signal(1);
  tempAllowVoteChange = signal(true);
  tempVoteDuration = signal(15);

  // Modals Visibility
  showResultModal = signal(false);
  showDrawModal = signal(false);
  showSettingsModal = signal(false);
  showAvatarModal = signal(false);
  showQrModal = signal(false);
  showErrorModal = signal(false);
  showExitConfirm = signal(false);
  showToast = signal(false);

  // Helpers
  qrCodeUrl = signal<string | null>(null);
  previewAvatar = signal<string | null>(null);
  errorMessage = signal('');
  showHostPromotedModal = signal(false);
  emoji = '';

  private unsubRoom: any = null;
  private heartbeatInterval: any;
  private previousHostId: string | null = null;

  // ==========================================
  // 3. COMPUTED SIGNALS
  // ==========================================
  status = computed(() => this.room()?.game?.status || 'lobby');
  isLobby = computed(() => this.status() === 'lobby');
  isVoting = computed(() => this.status() === 'voting');
  isDiscussion = computed(
    () =>
      (this.status() === 'playing' || this.status() === 'discussion') &&
      !this.showWord()
  );
  isGameOver = computed(() => this.status() === 'game_over');

  isHost = computed(() => this.room()?.hostId === this.playerId);
  myRoleRaw = computed(() => this.room()?.players?.[this.playerId]?.role);
  isSpy = computed(() => this.myRoleRaw() === 'spy');
  isEliminated = computed(
    () => this.room()?.players?.[this.playerId]?.eliminated
  );

  myWord = computed(() => {
    const role = this.myRoleRaw();
    return role ? this.room()?.wordPair?.[role] : '???';
  });

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

  currentSpyCount = computed(() => this.room()?.config?.spyCount || 1);
  minRequiredPlayers = computed(() => this.currentSpyCount() * 2 + 1);
  tempMinRequired = computed(() => this.tempSpyCount() * 2 + 1);

  voteCounts = computed(() => {
    const counts: Record<string, number> = {};
    Object.values(this.room()?.players || {}).forEach((p: any) => {
      if (p.vote) counts[p.vote] = (counts[p.vote] || 0) + 1;
    });
    return counts;
  });

  winner = computed(() => {
    this.emoji = this.randomEmoji();
    return this.room()?.game?.winner;
  });
  endReason = computed(() => this.room()?.game?.endReason);
  heroId = computed(() => this.room()?.game?.heroId);
  heroName = computed(() => {
    const id = this.heroId();
    return id ? this.room()?.players[id]?.name : '';
  });
  spiesList = computed(() => {
    const players = this.room()?.players || {};
    return (Object.values(players) as Player[]).filter((p) => p.role === 'spy');
  });
  viewingUser = signal<any>(null);

  // ==========================================
  // 4. LIFECYCLE & INITIALIZATION
  // ==========================================
  constructor(private game: GameService, private route: ActivatedRoute) {
    // Effect 1: Handle Vote Timer
    effect(() => {
      const g = this.room()?.game;
      if (g?.status !== 'voting') {
        this.selectedVoteId.set(null);
        return;
      }
      const DURATION_SEC = this.room()?.config?.voteDuration || 30;
      const DURATION_MS = DURATION_SEC * 1000;

      const tick = () => {
        if (!g.voteStartedAt) return;
        const now = Date.now();
        const elapsed = now - g.voteStartedAt;
        if (elapsed > DURATION_MS + 5000) return;

        const remain = Math.max(0, DURATION_MS - elapsed);
        const seconds = Math.ceil(remain / 1000);

        if (this.voteCountdown() !== seconds) this.voteCountdown.set(seconds);
        if (remain <= 0) {
          clearInterval(i);
          if (this.isHost())
            setTimeout(() => this.game.resolveVote(this.roomId()!), 2000);
        }
      };
      tick();
      const i = setInterval(tick, 1000);
      return () => clearInterval(i);
    });

    // Effect 2: Auto Show Role
    effect(() => {
      if (this.room()?.game?.status === 'playing' && !this.hasSeenRole) {
        this.showWord.set(true);
      }
    });

    // Effect 3: Handle Game Status Transitions
    effect(() => {
      const status = this.room()?.game?.status;
      if (status === 'lobby') {
        this.resetGameplayState();
        return;
      }
      if (status === 'reveal' || status === 'game_over') {
        this.showResultModal.set(true);
        if (status === 'reveal')
          setTimeout(() => this.closeResultModal(), 5000);
      } else if (status === 'draw') {
        this.showDrawModal.set(true);
        setTimeout(() => this.closeDrawModal(), 3000);
      }
    });

    // Parse URL Params
    this.route.queryParams.subscribe((params) => {
      if (params['room']) {
        this.joinRoomInput.set(params['room']);
        this.qrCodeUrl.set(null);
        this.viewMode.set('join_input');
      }
    });

    this.startHeartbeat();
  }

  ngOnDestroy() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.unsubRoom) this.unsubRoom();
  }

  // ==========================================
  // 5. GAME LOGIC METHODS
  // ==========================================
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (!this.joined() || !this.roomId() || !this.room()) return;
      const myPlayer = this.room().players[this.playerId];
      if (!myPlayer) return;

      const isBrowserOffline = !navigator.onLine;
      const isDbOffline = myPlayer.isOnline === false;

      if (isBrowserOffline || isDbOffline) {
        if (this.connectionStatus() !== 'connecting') {
          this.connectionStatus.set('connecting');
          this.showToast.set(true);
        }
        if (!isBrowserOffline) {
          this.game
            .setPlayerOnline(this.roomId()!, this.playerId)
            .catch(() => {});
        }
      } else if (this.connectionStatus() === 'connecting') {
        this.connectionStatus.set('connected');
        this.showToast.set(true);
        setTimeout(() => {
          if (this.connectionStatus() === 'connected')
            this.showToast.set(false);
        }, 3000);
      }
    }, 3000);
  }

  listen() {
    if (this.unsubRoom) this.unsubRoom();

    this.unsubRoom = this.game.listenRoom(this.roomId()!, (data) => {
      // 1. Check phòng bị xóa
      if (!data) { this.forceExit(); return; }

      // 2. Check bị kick
      if (data.players && !data.players[this.playerId]) {
        this.errorMessage.set('Bạn đã thoát ra khỏi phòng!');
        this.showErrorModal.set(true);
        this.resetLocalState();
        return;
      }

      // [FIX 2] LOGIC QUÉT PHÒNG MA (ZOMBIE ROOM)
      // Nếu game đang diễn ra (Playing/Voting) 
      // MÀ chỉ có 1 người Online (là chính mình) -> Hủy phòng luôn
      const status = data.game?.status;
      if (status === 'playing' || status === 'voting' || status === 'discussion') {
          const onlinePlayers = Object.values(data.players || {}).filter((p: any) => p.isOnline);
          
          if (onlinePlayers.length <= 1) {
              // Gọi Service xóa phòng ngay lập tức
              this.game.deleteRoom(this.roomId()!);
              
              // Thông báo cho người dùng
              this.errorMessage.set('Tất cả người chơi khác đã mất kết nối. Phòng đã bị hủy!');
              this.showErrorModal.set(true);
              
              this.resetLocalState();
              return; // Dừng xử lý tiếp
          }
      }

      // [FIX 3] LOGIC THĂNG CHỨC (Đã sửa lỗi hiện nhầm)
      // Chỉ chạy logic này nếu previousHostId đã có giá trị (tức là không phải lần đầu vào phòng)
      if (this.previousHostId && this.previousHostId !== data.hostId) {
          if (data.hostId === this.playerId) {
              this.showHostPromotedModal.set(true);
          }
      }
      this.previousHostId = data.hostId; // Cập nhật host mới

      // Check tính khả thi của game (nếu Host thoát khi đang chơi)
      if (this.playerId === data.hostId && (status === 'playing' || status === 'voting')) {
        this.game.checkGameViability(this.roomId()!);
      }
      
      this.room.set(data);
    });
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
    } catch (e) {}
    this.resetLocalState();
  }

  forceExit() {
    this.errorMessage.set('Chủ phòng đã giải tán phòng chơi!');
    this.showErrorModal.set(true);
    this.resetLocalState();
  }
  closeHostPromotedModal() {
    this.showHostPromotedModal.set(false);
  }
  startGame() {
    this.game.startGame(this.roomId()!, this.playerId);
  }
  startVoting() {
    this.game.startVoting(this.roomId()!);
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

  async submitGuess() {
    if (!this.guessInput()) return;
    await this.game.guessWord(this.roomId()!, this.playerId, this.guessInput());
    this.closeGuessModal();
  }

  async backToLobby() {
    if (this.isHost()) {
      const { index, nextUsedIndices } = this.pickUniqueWordIndex();
      const newPair = wordData[index];
      await this.game.backToLobby(this.roomId()!, newPair, nextUsedIndices);
    }
    this.showResultModal.set(false);
  }

  // ==========================================
  // 6. UI HELPER METHODS
  // ==========================================
  resetGameplayState() {
    this.showResultModal.set(false);
    this.showDrawModal.set(false);
    this.isSpyGuessing.set(false);
    this.showWord.set(false);
    this.hasSeenRole = false;
    this.voteCountdown.set(0);
    this.selectedVoteId.set(null);
  }

  private resetLocalState() {
    if (this.unsubRoom) { this.unsubRoom(); this.unsubRoom = null; }
     
    this.previousHostId = null;  
    
    this.joined.set(false);
    this.roomId.set(null);
    this.room.set(null);
    this.joinRoomInput.set('');
    this.qrCodeUrl.set(null);

    // Đóng tất cả modal
    this.showResultModal.set(false);
    this.showDrawModal.set(false);
    this.showSettingsModal.set(false);
    this.showHostPromotedModal.set(false);  
    this.showErrorModal.set(false);
    
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
    if (this.isEliminated()) return;
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

  onAvatarClick(player: any) {
    if (player.id === this.playerId) {
      if (this.isLobby()) {
        this.previewAvatar.set(null);
        this.showAvatarModal.set(true);
      }
      return;
    }
    this.viewingUser.set(player);
  }

  async copyRoomId() {
    if (this.roomId()) {
      await navigator.clipboard.writeText(this.roomId()!);
      this.isCopied.set(true);
      setTimeout(() => this.isCopied.set(false), 2000);
    }
  }

  generateRoomId(): string {
    return Math.floor(10000000 + Math.random() * 90000000).toString();
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

  // Modals & Settings
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

  openExitConfirm() {
    this.showExitConfirm.set(true);
  }
  closeExitConfirm() {
    this.showExitConfirm.set(false);
  }
  confirmExit() {
    this.exitGame();
    this.closeExitConfirm();
  }
  closeErrorModal() {
    this.showErrorModal.set(false);
    this.errorMessage.set('');
  }

  openGuessModal() {
    this.guessInput.set('');
    this.isGuessing.set(true);
  }
  closeGuessModal() {
    this.isGuessing.set(false);
  }

  closeResultModal() {
    this.showResultModal.set(false);
    if (this.room()?.game?.status === 'reveal')
      this.game.endReveal(this.roomId()!);
  }
  closeDrawModal() {
    this.showDrawModal.set(false);
    this.game.endReveal(this.roomId()!);
  }

  // Avatar Utils
  openPreview(img: string) {
    this.previewAvatar.set(img);
  }
  backToList() {
    this.previewAvatar.set(null);
  }
  confirmAvatar() {
    const img = this.previewAvatar();
    if (img && this.roomId()) {
      this.game.updateAvatar(this.roomId()!, this.playerId, img);
      this.showAvatarModal.set(false);
      this.previewAvatar.set(null);
    }
  }
  closeViewUser() {
    this.viewingUser.set(null);
  }

  // Misc Utils
  toggleTheme() {
    document.body.classList.toggle('dark-mode');
  }
  toggleWordVisibility() {
    this.isWordVisible.update((v) => !v);
  }
  toggleReviewKeyword() {
    this.isReviewingKeyword.update((v) => !v);
  }
  acknowledgeRole() {
    this.hasSeenRole = true;
    this.showWord.set(false);
  }

  onNameInput(val: string) {
    this.playerName.set(val);
    if (val) this.isNameError.set(false);
  }
  onRoomInput(event: Event) {
    this.onlyNumberInput(event);
    this.isRoomError.set(false);
  }
  onlyNumberInput(event: Event) {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 8);
    this.joinRoomInput.set(input.value);
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
    return emojis[Math.floor(Math.random() * emojis.length)];
  }

  getVoteDots(playerId: string): number[] {
    return Array(this.voteCounts()[playerId] || 0).fill(0);
  }

  private pickUniqueWordIndex(): { index: number; nextUsedIndices: number[] } {
    const totalWords = wordData.length;
    const currentUsed = this.room()?.usedIndices || [];
    let availableIndices: number[] = [];
    for (let i = 0; i < totalWords; i++) {
      if (!currentUsed.includes(i)) availableIndices.push(i);
    }
    if (availableIndices.length === 0) {
      availableIndices = Array.from({ length: totalWords }, (_, i) => i);
    }
    const randomIndex = Math.floor(Math.random() * availableIndices.length);
    const selectedIndex = availableIndices[randomIndex];
    let nextUsedIndices: number[] = [];
    if (availableIndices.length === totalWords)
      nextUsedIndices = [selectedIndex];
    else nextUsedIndices = [...currentUsed, selectedIndex];
    return { index: selectedIndex, nextUsedIndices };
  }
}
