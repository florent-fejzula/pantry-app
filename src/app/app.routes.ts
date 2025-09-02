// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { IdeasComponent } from './components/ideas/ideas.component';
import { PantryMainComponent } from './components/pantry-main/pantry-main.component';

export const routes: Routes = [
  { path: '', component: PantryMainComponent },
  { path: 'ideas', component: IdeasComponent },
];
