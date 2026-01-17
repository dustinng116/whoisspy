import { Component, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { GameService } from './game.service';
import QRCode from 'qrcode';

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

  // State
  viewMode = signal<'home' | 'join_input'>('home');
  roomId = signal<string | null>(null);
  playerName = signal('');
  playerId = crypto.randomUUID();
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

  currentSpyCount = computed(() => this.room()?.config?.spyCount || 1);
  minRequiredPlayers = computed(() => this.currentSpyCount() * 2 + 1);
  tempMinRequired = computed(() => this.tempSpyCount() * 2 + 1);
  viewingUser = signal<any>(null);
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
  ];

  constructor(private game: GameService) {
    // 1. Timer Vote Logic
    effect(() => {
      const g = this.room()?.game;
      if (g?.status !== 'voting') {
        this.selectedVoteId.set(null);
        return;
      }

      const tick = () => {
        const now = Date.now();
        const elapsed = now - (g.voteStartedAt || now);
        const remain = Math.max(0, this.VOTE_TIME - elapsed);

        this.voteCountdown.set(Math.ceil(remain / 1000));

        // Stale timestamp check
        if (elapsed > this.VOTE_TIME + 5000) return;

        if (remain <= 0) {
          this.game.resolveVote(this.roomId()!);
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
  }

  // ===== ACTIONS =====
  openSettings() {
    const config = this.room()?.config || {
      spyCount: 1,
      allowVoteChange: true,
    };
    this.tempSpyCount.set(config.spyCount);
    this.tempAllowVoteChange.set(config.allowVoteChange);
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

  async submitSpyGuess() {
    if (!this.spyGuessInput()) return;
    await this.game.spyGuessWord(
      this.roomId()!,
      this.playerId,
      this.spyGuessInput()
    );
    this.closeSpyGuess();
  }

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

  async createRoom() {
    if (!this.playerName()) return alert('Nhập tên');
    const id = this.generateRoomId();
    this.roomId.set(id);
    const pair = WORDS[Math.floor(Math.random() * WORDS.length)];
    await this.game.createRoom(id, this.playerId, this.playerName(), pair);
    this.joined.set(true);
    this.listen();
  }
  async joinRoom() {
    if (this.joinRoomInput().length !== 8 || !this.playerName()) return;
    this.roomId.set(this.joinRoomInput());
    await this.game.joinRoom(
      this.joinRoomInput(),
      this.playerId,
      this.playerName()
    );
    this.joined.set(true);
    this.listen();
  }
  startGame() {
    this.game.startGame(this.roomId()!, this.playerId);
  }
  startVoting() {
    this.game.startVoting(this.roomId()!);
  }
  listen() {
    this.game.listenRoom(this.roomId()!, (data) => this.room.set(data));
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
    if (!this.playerName()) return alert('Nhập tên');
    this.viewMode.set('join_input');
  }
  acknowledgeRole() {
    this.hasSeenRole = true;
    this.showWord.set(false);
  }
  async backToLobby() {
    if (this.isHost()) {
      await this.game.resetRoom(this.roomId()!);
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
  winner = computed(() => this.room()?.game?.winner); // 'spy' or 'villian'

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

const WORDS = [
  { villian: 'Cà phê', spy: 'Trà sữa' },
  { villian: 'Bệnh viện', spy: 'Phòng khám' },
  { villian: 'Superman', spy: 'Batman' },
  { villian: 'Facebook', spy: 'Instagram' },
  { villian: 'Piano', spy: 'Guitar' },
];
