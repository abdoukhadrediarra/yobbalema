import { Component } from '@angular/core';
import { environment } from '../../../environments/environment';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {
  readonly year = new Date().getFullYear();
  private readonly env = environment as { supportEmail?: string; supportPhone?: string };
  readonly email = this.env.supportEmail ?? 'contact@yobbalema.sn';
  readonly phone = this.env.supportPhone ?? '';
}
