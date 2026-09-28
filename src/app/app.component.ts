import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { NavbarComponent } from './shared/navbar/navbar.component';
import { FooterComponent } from './shared/footer/footer.component';
import { ToastHostComponent } from './shared/toast-host/toast-host.component';

/** Routes qui gèrent leur propre mise en page plein écran (pas de navbar/footer globaux). */
const ROUTES_SANS_CHROME = ['/connexion', '/inscription', '/mot-de-passe-oublie', '/nouveau-mot-de-passe'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent, FooterComponent, ToastHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects)
    ),
    { initialValue: this.router.url }
  );

  readonly showChrome = () => !ROUTES_SANS_CHROME.some((r) => this.url().startsWith(r));
}
