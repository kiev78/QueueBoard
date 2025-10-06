import { Routes } from '@angular/router';
import { provideRoutes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		pathMatch: 'full',
		redirectTo: 'organizer'
	},
	{
		path: 'organizer',
		loadComponent: () => import('./organizer/organizer.component').then(m => m.OrganizerComponent)
	}
];
