import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';

import { SelectLabelComponent } from './select-recipe.component';

@NgModule({
  declarations: [
    SelectLabelComponent
  ],
  imports: [
    CommonModule,
    IonicModule
  ],
  exports: [
    SelectLabelComponent
  ]
})
export class SelectLabelModule { }
