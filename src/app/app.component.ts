import { Component } from '@angular/core';
import { GameComponent } from './game/game.component';

@Component({
  selector: 'app-root',
  imports: [GameComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'who-is-spy';
}
