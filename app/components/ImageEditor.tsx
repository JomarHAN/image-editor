'use client';

import { useState, useRef, useCallback } from 'react';

interface Position {
  x: number;
  y: number;
}

interface ApiResponse {
  success: boolean;
  editedImageUrl?: string;
  error?: string;
}

export default function ImageEditor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalImageDataRef = useRef<ImageData | null>(null);
  
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [brushSize, setBrushSize] = useState<number>(20);
  const [prompt, setPrompt] = useState<string>('');
  const [editedImage, setEditedImage] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null); // Add mask image state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Helper function to compress image until it's under the size limit
  const compressImage = useCallback((file: File, maxSizeKB: number = 4000): Promise<File> => {
    return new Promise((resolve) => {
      if (file.size <= maxSizeKB * 1024) {
        resolve(file);
        return;
      }

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Start with aggressive compression for very large files
        const quality = file.size > 10 * 1024 * 1024 ? 0.3 : 0.7; // 30% for files > 10MB, 70% otherwise
        const maxDimension = file.size > 10 * 1024 * 1024 ? 800 : 1200; // Smaller dimensions for very large files
        
        const compressWithSettings = (targetQuality: number, targetDimension: number) => {
          // Calculate new dimensions
          let { width, height } = img;
          
          if (width > height) {
            if (width > targetDimension) {
              height = (height * targetDimension) / width;
              width = targetDimension;
            }
          } else {
            if (height > targetDimension) {
              width = (width * targetDimension) / height;
              height = targetDimension;
            }
          }

          canvas.width = width;
          canvas.height = height;

          if (ctx) {
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            
            canvas.toBlob((blob) => {
              if (blob) {
                const compressedFile = new File([blob], file.name, {
                  type: 'image/jpeg',
                  lastModified: Date.now()
                });
                
                console.log(`Compressed: ${Math.round(file.size / 1024)}KB → ${Math.round(compressedFile.size / 1024)}KB (Quality: ${Math.round(targetQuality * 100)}%, Dimension: ${Math.round(Math.max(width, height))}px)`);
                
                // Check if still too large and compress further
                if (compressedFile.size > maxSizeKB * 1024) {
                  if (targetQuality > 0.1 && targetDimension > 400) {
                    // Reduce quality and/or dimensions further
                    const newQuality = Math.max(0.1, targetQuality - 0.2);
                    const newDimension = Math.max(400, targetDimension - 200);
                    console.log(`Still too large (${Math.round(compressedFile.size / 1024)}KB), trying quality: ${Math.round(newQuality * 100)}%, dimension: ${newDimension}px`);
                    compressWithSettings(newQuality, newDimension);
                  } else {
                    // Can't compress further, return what we have
                    console.warn(`Cannot compress further. Final size: ${Math.round(compressedFile.size / 1024)}KB`);
                    resolve(compressedFile);
                  }
                } else {
                  resolve(compressedFile);
                }
              } else {
                resolve(file);
              }
            }, 'image/jpeg', targetQuality);
          } else {
            resolve(file);
          }
        };

        compressWithSettings(quality, maxDimension);
      };

      img.onerror = () => {
        resolve(file);
      };

      img.src = URL.createObjectURL(file);
    });
  }, []);

  // Handle image upload with iterative compression
  const handleImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (file) {
      setError('');
      setEditedImage(null);
      setMaskImage(null);
      
      try {
        console.log(`Original file size: ${Math.round(file.size / 1024)}KB`);
        
        // Compress image until it's under 4MB
        const compressedFile = await compressImage(file, 4000); // 4MB = 4000KB
        
        console.log(`Final compressed size: ${Math.round(compressedFile.size / 1024)}KB`);
        
        setOriginalFile(compressedFile);
        
        const reader = new FileReader();
        reader.onload = (e: ProgressEvent<FileReader>): void => {
          if (e.target?.result && typeof e.target.result === 'string') {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = (): void => {
              setImage(img);
              setupCanvas(img);
            };
            img.onerror = (): void => {
              setError('Failed to load image. Please try another file.');
            };
            img.src = e.target.result;
          }
        };
        reader.onerror = (): void => {
          setError('Failed to read file. Please try again.');
        };
        reader.readAsDataURL(compressedFile);
      } catch (err) {
        console.error('Error processing image:', err);
        setError('Failed to process image. Please try another file.');
      }
    }
  }, [compressImage]);

  // Setup canvas with image
  const setupCanvas = (img: HTMLImageElement): void => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    
    if (!canvas || !maskCanvas) {
      return;
    }
    
    const ctx = canvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    
    if (!ctx || !maskCtx) {
      return;
    }

    // Set canvas dimensions to exact image dimensions
    canvas.width = img.width;
    canvas.height = img.height;
    maskCanvas.width = img.width;
    maskCanvas.height = img.height;

    // Remove any inline styles to let CSS handle the display
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '';
    canvas.style.maxHeight = '';

    // Draw image at original size
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    
    // Store original image data for quick restoration
    originalImageDataRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Initialize mask canvas with black background
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, img.width, img.height);
  };

  // Get position accounting for canvas scaling
  const getPosition = useCallback((event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): Position => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX: number, clientY: number;
    
    if ('touches' in event && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if ('clientX' in event) {
      clientX = event.clientX;
      clientY = event.clientY;
    } else {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  }, []);

  // Update canvas with mask overlay
  const updateCanvasWithMask = useCallback((): void => {
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    
    if (!canvas || !maskCanvas || !originalImageDataRef.current) return;
    
    const ctx = canvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    
    if (!ctx || !maskCtx) return;

    // Restore original image
    ctx.putImageData(originalImageDataRef.current, 0, 0);

    // Get mask data
    const maskImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    
    // Create overlay for masked areas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    for (let i = 0; i < maskImageData.data.length; i += 4) {
      if (maskImageData.data[i] > 128) { // White areas in mask
        // Apply red tint to show masked areas
        imageData.data[i] = Math.min(255, imageData.data[i] + 100);     // Add red
        imageData.data[i + 1] = Math.max(0, imageData.data[i + 1] - 50); // Reduce green
        imageData.data[i + 2] = Math.max(0, imageData.data[i + 2] - 50); // Reduce blue
      }
    }
    
    ctx.putImageData(imageData, 0, 0);
  }, []);

  // Draw mask
  const drawMask = useCallback((x: number, y: number): void => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) return;
    
    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) return;

    // Draw white circle on mask canvas
    maskCtx.fillStyle = 'white';
    maskCtx.beginPath();
    maskCtx.arc(x, y, brushSize / 2, 0, 2 * Math.PI);
    maskCtx.fill();

    // Update display
    updateCanvasWithMask();
  }, [brushSize, updateCanvasWithMask]);

  // Drawing event handlers
  const startDrawing = useCallback((event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    setIsDrawing(true);
    const pos = getPosition(event);
    drawMask(pos.x, pos.y);
  }, [getPosition, drawMask]);

  const continueDrawing = useCallback((event: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    if (!isDrawing) return;
    const pos = getPosition(event);
    drawMask(pos.x, pos.y);
  }, [isDrawing, getPosition, drawMask]);

  const stopDrawing = useCallback((): void => {
    setIsDrawing(false);
  }, []);

  // Clear mask
  const clearMask = useCallback((): void => {
    if (!originalImageDataRef.current) return;
    
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!canvas || !maskCanvas) return;
    
    const ctx = canvas.getContext('2d');
    const maskCtx = maskCanvas.getContext('2d');
    if (!ctx || !maskCtx) return;
    
    // Reset mask to black
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    
    // Restore original image
    ctx.putImageData(originalImageDataRef.current, 0, 0);
  }, []);

  // Generate and display mask image with alpha channel
  const generateMaskImage = useCallback((): void => {
    const maskCanvas = maskCanvasRef.current;
    if (!maskCanvas) {
      setError('Mask canvas not found');
      return;
    }

    const maskCtx = maskCanvas.getContext('2d');
    if (!maskCtx) {
      setError('Mask canvas context not found');
      return;
    }

    // Create a new canvas for the alpha mask
    const alphaCanvas = document.createElement('canvas');
    alphaCanvas.width = maskCanvas.width;
    alphaCanvas.height = maskCanvas.height;
    const alphaCtx = alphaCanvas.getContext('2d');
    
    if (!alphaCtx) {
      setError('Alpha canvas context not found');
      return;
    }

    // Get the current mask data (black background, white drawn areas)
    const maskImageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    
    // Create new image data for alpha mask
    const alphaImageData = alphaCtx.createImageData(maskCanvas.width, maskCanvas.height);
    
    // Convert to proper alpha mask:
    // - Transparent areas (alpha = 0) where mask is black (areas to preserve)
    // - Opaque white areas (alpha = 255) where mask is white (areas to edit)
    for (let i = 0; i < maskImageData.data.length; i += 4) {
      const isWhite = maskImageData.data[i] > 128; // Check if white (drawn area)
      
      if (isWhite) {
        // White areas in original mask -> Opaque white in alpha mask (areas to edit)
        alphaImageData.data[i] = 255;     // Red
        alphaImageData.data[i + 1] = 255; // Green  
        alphaImageData.data[i + 2] = 255; // Blue
        alphaImageData.data[i + 3] = 255; // Alpha (fully opaque)
      } else {
        // Black areas in original mask -> Transparent in alpha mask (areas to preserve)
        alphaImageData.data[i] = 0;       // Red
        alphaImageData.data[i + 1] = 0;   // Green
        alphaImageData.data[i + 2] = 0;   // Blue
        alphaImageData.data[i + 3] = 0;   // Alpha (fully transparent)
      }
    }
    
    // Put the alpha image data on the alpha canvas
    alphaCtx.putImageData(alphaImageData, 0, 0);
    
    // Convert alpha canvas to data URL and set as mask image
    const maskDataUrl = alphaCanvas.toDataURL('image/png');
    setMaskImage(maskDataUrl);
    setError(''); // Clear any previous errors
  }, []);

  // Download mask image
  const downloadMask = useCallback((): void => {
    if (!maskImage) return;
    
    const link = document.createElement('a');
    link.href = maskImage;
    link.download = 'mask.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [maskImage]);
  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!originalFile || !prompt.trim()) {
      setError('Please upload an image and enter a prompt');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) {
        throw new Error('Mask canvas not found');
      }

      const maskBlob = await new Promise<Blob>((resolve, reject) => {
        maskCanvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create mask blob'));
          }
        }, 'image/png');
      });

      const formData = new FormData();
      formData.append('image', originalFile);
      formData.append('mask', maskBlob);
      formData.append('prompt', prompt);

      const response = await fetch('/api/edit-image', {
        method: 'POST',
        body: formData,
      });

      console.log('API response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('API error response:', errorText);
        throw new Error(`API request failed with status ${response.status}`);
      }

      const result: ApiResponse = await response.json();
      console.log('API result:', result);

      if (result.success && result.editedImageUrl) {
        setEditedImage(result.editedImageUrl);
        setError(''); // Clear any previous errors
      } else {
        setError(result.error || 'Failed to edit image - no URL returned');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError('Error submitting request: ' + errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [originalFile, prompt]);

  const handleBrushSizeChange = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    setBrushSize(parseInt(event.target.value));
  }, []);

  const handlePromptChange = useCallback((event: React.ChangeEvent<HTMLInputElement>): void => {
    setPrompt(event.target.value);
  }, []);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">AI Image Editor</h1>
      
      {/* Upload Section */}
      <div className="mb-6">
        <label className="block text-sm font-medium mb-2">
          Upload Image
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageUpload}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        <p className="text-xs text-gray-500 mt-1">
          Large images will be automatically compressed to under 4MB. Very large files may take a moment to process.
        </p>
      </div>

      {/* Controls */}
      {image && (
        <div className="mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Brush Size: {brushSize}px
              </label>
              <input
                type="range"
                min="20"
                max="500"
                value={brushSize}
                onChange={handleBrushSizeChange}
                className="w-full"
              />
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={clearMask}
                type="button"
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                Clear Mask
              </button>
              
              <button
                onClick={generateMaskImage}
                type="button"
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
              >
                Generate Mask
              </button>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Edit Prompt (describe what you want to change)
            </label>
            <input
              type="text"
              value={prompt}
              onChange={handlePromptChange}
              placeholder="e.g., 'add a red sports car' or 'remove the person'"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || !prompt.trim()}
            type="button"
            className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Processing...' : 'Edit Image'}
          </button>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {/* Canvas and Result */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Original with Mask */}
        {image && (
          <div className="w-full">
            <h3 className="text-lg font-semibold mb-2">
              Original Image ({image.width} × {image.height}px)
            </h3>
            <div className="w-full border-2 border-gray-300 rounded-lg bg-white p-4 flex items-center justify-center min-h-[400px]">
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-[600px] cursor-crosshair object-contain"
                style={{ 
                  touchAction: 'none',
                  display: 'block'
                }}
                onMouseDown={startDrawing}
                onMouseMove={continueDrawing}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={continueDrawing}
                onTouchEnd={stopDrawing}
              />
            </div>
            <canvas ref={maskCanvasRef} className="hidden" />
            <p className="text-sm text-gray-600 mt-2">
              Draw mask areas (shown with red tint)
            </p>
          </div>
        )}

        {/* Generated Mask */}
        {maskImage && image && (
          <div className="w-full">
            <h3 className="text-lg font-semibold mb-2">
              Generated Mask ({image.width} × {image.height}px)
            </h3>
            <div className="w-full border-2 border-gray-300 rounded-lg bg-white p-4 flex items-center justify-center min-h-[400px]">
              <img 
                src={maskImage} 
                alt="Generated mask" 
                className="max-w-full max-h-[600px] object-contain"
                style={{ 
                  imageRendering: 'pixelated'
                }}
              />
            </div>
            <button
              onClick={downloadMask}
              className="inline-block mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Download Mask
            </button>
          </div>
        )}

        {/* AI Edited Result */}
        {editedImage && image && (
          <div className="w-full">
            <h3 className="text-lg font-semibold mb-2">
              AI Edited Image ({image.width} × {image.height}px)
            </h3>
            <div className="w-full border-2 border-gray-300 rounded-lg bg-white p-4 flex items-center justify-center min-h-[400px]">
              <img 
                src={editedImage} 
                alt="Edited result" 
                className="max-w-full max-h-[600px] object-contain"
              />
            </div>
            <a
              href={editedImage}
              download="edited-image.png"
              className="inline-block mt-2 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              Download Result
            </a>
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="mt-8 p-4 bg-gray-50 rounded-lg">
        <h3 className="font-semibold mb-2">How to use:</h3>
        <ol className="list-decimal list-inside space-y-1 text-sm">
          <li>Upload an image (PNG, JPG, etc.)</li>
          <li>Use your mouse or finger to draw over areas you want to edit (shown with red tint)</li>
          <li>Adjust brush size as needed</li>
          <li>Enter a descriptive prompt for what you want to change</li>
          <li>Click &quot;Edit Image&quot; to process with AI</li>
          <li>Download your edited result</li>
        </ol>
        
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-sm text-yellow-800">
            <strong>Workflow:</strong>
          </p>
          <ol className="text-sm text-yellow-800 mt-2 space-y-1">
            <li><strong>1.</strong> Draw mask areas (shown with red tint)</li>
            <li><strong>2.</strong> Click &quot;Generate Mask&quot; to create the proper alpha mask</li>
            <li><strong>3.</strong> Use the mask for AI editing or download it directly</li>
          </ol>
          <p className="text-sm text-yellow-800 mt-2">
            <strong>Mask Format:</strong> Transparent areas = preserve, Opaque white = edit (with alpha channel for OpenAI API compatibility)
          </p>
        </div>
      </div>
    </div>
  );
}