import { Component, Input, Output, EventEmitter, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ImageCropperComponent, ImageCroppedEvent } from 'ngx-image-cropper';

@Component({
  selector: 'image-cropper-modal',
  standalone: true,
  imports: [CommonModule, ImageCropperComponent],
  template: `
    <div class="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50">
      <div class="bg-gray-800 p-6 rounded-lg w-[400px] max-w-full flex flex-col items-center relative">
        <h2 class="text-xl font-bold text-white mb-4">Edit Image</h2>
        <div class="relative w-full overflow-hidden" #cropperContainer>
          <!-- Dark background around the circle -->
          <div class="absolute inset-0 bg-gray-900 z-10"></div>

          <!-- Image Cropper -->
          <image-cropper
            #imageCropper
            [imageBase64]="imageBase64 || ''"
            [maintainAspectRatio]="true"
            [aspectRatio]="1"
            [resizeToWidth]="256"
            format="png"
            (imageCropped)="onCropped($event)"
            [imageQuality]="100"
            [containWithinAspectRatio]="true"
            [cropperStaticWidth]="cropSize"
            [cropperStaticHeight]="cropSize"
            [alignImage]="'center'"
            [backgroundColor]="'transparent'"
            [canvasRotation]="0"
            [hideResizeSquares]="true"
            [cropperMinWidth]="cropSize"
            [cropperMinHeight]="cropSize"
            [cropperMaxWidth]="cropSize"
            [cropperMaxHeight]="cropSize"
            [disabled]="false"
            [allowMoveImage]="true"
            [transform]="{ translateH: 0, translateV: 0 }"
            class="cropper-container"
          ></image-cropper>

          <!-- Circle overlay - purely visual -->
          <div class="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div
              class="rounded-full border-2 border-white"
              [style.width.px]="cropSize"
              [style.height.px]="cropSize"
            ></div>
          </div>
        </div>

        <div class="flex justify-between w-full mt-4">
          <button (click)="reset()" class="text-blue-400 hover:underline">Reset</button>
          <div class="flex space-x-3">
            <button (click)="cancel.emit()" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-500">
              Cancel
            </button>
            <button (click)="applyCrop()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500">
              Apply
            </button>
          </div>
        </div>
        <button (click)="cancel.emit()" class="absolute top-2 right-2 text-gray-400 hover:text-white text-2xl">
          &times;
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .cropper-container {
        width: 100%;
        display: block;
        margin: 0 auto;
        max-height: 320px;
        z-index: 15;
        position: relative;
      }

      ::ng-deep .ngx-ic-cropper {
        outline: none !important;
        border: none !important;
        box-shadow: none !important;
      }

      ::ng-deep .ngx-ic-overlay {
        outline: none !important;
        border: none !important;
        box-shadow: none !important;
        background-color: transparent !important;
        opacity: 0 !important;
      }

      ::ng-deep image-cropper .source-image {
        transform-origin: center;
        max-height: 100%;
        max-width: 100%;
      }

      ::ng-deep .move {
        cursor: move !important;
      }

      ::ng-deep .ngx-ic-resize,
      ::ng-deep .ngx-ic-square {
        display: none !important;
      }
    `,
  ],
})
export class ImageCropperModalComponent implements OnInit, AfterViewInit {
  @Input() imageBase64: string | null | undefined = undefined;
  @Output() cropped = new EventEmitter<string>();
  @Output() cancel = new EventEmitter<void>();

  @ViewChild('cropperContainer') cropperContainer!: ElementRef;
  @ViewChild('imageCropper') imageCropper!: ImageCropperComponent;

  cropSize = 230; // Slightly smaller to ensure it fits nicely
  private croppedImage: string | null = null;
  private originalImage: string | null | undefined = undefined;

  ngOnInit() {
    // Store original image for reset functionality
    this.originalImage = this.imageBase64;
  }

  ngAfterViewInit() {
    // Adjust crop size if needed based on container
    setTimeout(() => {
      if (this.cropperContainer?.nativeElement) {
        const containerWidth = this.cropperContainer.nativeElement.clientWidth;
        const containerHeight = this.cropperContainer.nativeElement.clientHeight;
        // Calculate the maximum size that fits
        const maxSize = Math.min(containerWidth, containerHeight) - 20;
        this.cropSize = Math.min(this.cropSize, maxSize);
      }

      // Force specific style manipulations after view init
      this.applyAdditionalStyles();
    }, 100);
  }

  private applyAdditionalStyles() {
    // Find and manipulate specific elements to enforce constraints
    setTimeout(() => {
      const cropperElement = document.querySelector('.ngx-ic-cropper') as HTMLElement;
      if (cropperElement) {
        cropperElement.style.opacity = '0';
      }

      // Make sure the image can only be moved horizontally if wider than crop area
      const imageElement = document.querySelector('.source-image') as HTMLElement;
      if (imageElement) {
        imageElement.style.maxHeight = `${this.cropSize}px`;
      }
    }, 200);
  }

  onCropped(event: ImageCroppedEvent) {
    this.croppedImage = event.base64 || null;
  }

  applyCrop() {
    if (this.croppedImage) {
      this.cropped.emit(this.croppedImage);
    }
  }

  reset() {
    // Clone the string to trigger change detection
    const temp = this.originalImage;
    this.imageBase64 = undefined;
    setTimeout(() => {
      this.imageBase64 = temp;
      // Re-apply styles after reset
      setTimeout(() => this.applyAdditionalStyles(), 200);
    }, 0);
  }
}
