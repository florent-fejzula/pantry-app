import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Idea } from '../../models/idea.model';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrls: ['./results.component.scss'],
})
export class ResultsComponent {
  @Input() ideas: Idea[] = [];
  @Input() generatedOnce = false;

  trackById = (_: number, it: Idea) => it.id;
  bucket(items: Idea[], tier: 'READY'|'N1'|'N2') {
    return items.filter(i => i.readinessTier === tier);
  }
}
