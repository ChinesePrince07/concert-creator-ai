import '../ui/style.css';
import { store, type AppState, type Phase } from '../state/store';
import { libraryScreen } from './screens/library';
import { processingScreen } from './screens/processing';
import { studioScreen } from './screens/studio';

interface Screen {
  el: HTMLElement;
  update?(s: AppState): void;
  dispose?(): void;
}

export function mountApp(root: HTMLElement): void {
  let currentPhase: Phase | null = null;
  let screen: Screen | null = null;

  function mount(state: AppState): void {
    screen?.dispose?.();
    root.innerHTML = '';
    switch (state.phase) {
      case 'library':
        screen = libraryScreen();
        break;
      case 'processing':
        screen = processingScreen(state);
        break;
      case 'studio':
        screen = studioScreen(state);
        break;
    }
    root.append(screen.el);
    currentPhase = state.phase;
  }

  store.subscribe((state) => {
    if (state.phase !== currentPhase) mount(state);
    else screen?.update?.(state);
  });

  mount(store.get());
}
