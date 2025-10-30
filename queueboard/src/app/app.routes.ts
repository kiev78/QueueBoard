import { Routes } from '@angular/router';

export const routes: Routes = [
	{
		path: '',
		pathMatch: 'full',
		redirectTo: 'organizer'
	},
	{
		path: 'organizer',
		loadComponent: () => import('./organizer/organizer.component').then(m => m.OrganizerComponent)
	},
	{
		path: 'transfer',
		loadComponent: () => import('./transfer/transfer.component').then(m => m.TransferComponent)
	}
];
