import { DecimalPipe } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

/** Sélecteur de note (1 à 5) ou affichage statique d'une note moyenne. */
@Component({
  selector: 'app-stars',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    @if (readonly) {
      <span class="stars stars--static" [attr.aria-label]="'Note ' + value + ' sur 5'">
        <i class="bi bi-star-fill"></i> {{ value | number: '1.1-1' }}
      </span>
    } @else {
      <span class="stars" role="radiogroup" aria-label="Votre note">
        @for (n of [1, 2, 3, 4, 5]; track n) {
          <button type="button" [class.on]="n <= value" (click)="valueChange.emit(n)" [attr.aria-label]="n + ' sur 5'">
            <i class="bi" [class]="n <= value ? 'bi-star-fill' : 'bi-star'"></i>
          </button>
        }
      </span>
    }
  `,
})
export class StarsComponent {
  @Input() value = 0;
  @Input() readonly = false;
  @Output() valueChange = new EventEmitter<number>();
}
