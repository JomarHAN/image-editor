import OpenAI from 'openai';
import { NextRequest, NextResponse } from 'next/server';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define response types
interface SuccessResponse {
  success: true;
  editedImageUrl: string;
}

interface ErrorResponse {
  success?: false;
  error: string;
}

type ApiResponse = SuccessResponse | ErrorResponse;

// Helper function to validate file type
function isValidImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

// Helper function to convert File to Buffer
async function fileToBuffer(file: File): Promise<Buffer> {
  const arrayBuffer = await file.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function POST(request: NextRequest): Promise<NextResponse<ApiResponse>> {
  try {
    const formData = await request.formData();
    
    // Extract and validate form data
    const imageFile = formData.get('image') as File | null;
    const maskFile = formData.get('mask') as File | null;
    const prompt = formData.get('prompt') as string | null;

    // Validate required fields
    if (!imageFile || !maskFile || !prompt) {
      return NextResponse.json(
        { error: 'Missing required fields: image, mask, and prompt' },
        { status: 400 }
      );
    }

    // Validate file sizes (OpenAI limit is 4MB)
    const maxSize = 4 * 1024 * 1024; // 4MB in bytes
    if (imageFile.size > maxSize) {
      return NextResponse.json(
        { error: `Image file too large: ${Math.round(imageFile.size / 1024 / 1024 * 100) / 100}MB. Maximum allowed: 4MB. Please resize your image.` },
        { status: 400 }
      );
    }

    if (maskFile.size > maxSize) {
      return NextResponse.json(
        { error: `Mask file too large: ${Math.round(maskFile.size / 1024 / 1024 * 100) / 100}MB. Maximum allowed: 4MB.` },
        { status: 400 }
      );
    }

    // Validate file types
    if (!isValidImageFile(imageFile)) {
      return NextResponse.json(
        { error: 'Invalid image file type. Please upload a valid image file.' },
        { status: 400 }
      );
    }

    if (!isValidImageFile(maskFile)) {
      return NextResponse.json(
        { error: 'Invalid mask file type. Please provide a valid mask image.' },
        { status: 400 }
      );
    }

    // Validate prompt
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json(
        { error: 'Prompt must be a non-empty string' },
        { status: 400 }
      );
    }

    // Enhanced prompt for landscape designer
    const enhancedPrompt = `You are a professional landscape designer. You are given an image of a landscape and a mask indicating specific areas to edit. 

        Your task:
        1. Only edit the areas specified by the mask (white/opaque areas)
        2. Maintain the original landscape's style, lighting, and perspective, and the original house structure and roof, driveway, road, sidewalk, and other structures
        3. Ensure the edited elements blend naturally with the existing landscape

        Edit request: ${prompt.trim()}

        Please seamlessly integrate this edit into the masked areas while preserving the natural look of the landscape.`;

    // Convert files to buffers
    const imageBuffer = await fileToBuffer(imageFile);
    const maskBuffer = await fileToBuffer(maskFile);

    // Create File objects for OpenAI API
    const imageForApi = new File([imageBuffer], 'image.png', { type: imageFile.type });
    const maskForApi = new File([maskBuffer], 'mask.png', { type: maskFile.type });

    console.log('Sending request to OpenAI with image size:', Math.round(imageFile.size / 1024), 'KB, mask size:', Math.round(maskFile.size / 1024), 'KB');

    // Make request to OpenAI API with gpt-image-1 model
    const response = await openai.images.edit({
      model: 'gpt-image-1',
      image: imageForApi,
      mask: maskForApi,
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024'
    });

    console.log('OpenAI response received:', response.data?.length, 'images');
    console.log('Response data:', JSON.stringify(response.data, null, 2));

    // Validate response - check different possible response formats
    if (!response.data || response.data.length === 0) {
      return NextResponse.json(
        { error: 'No edited image returned from OpenAI API' },
        { status: 500 }
      );
    }

    // Get the image URL - handle different response formats
    const imageData = response.data[0];
    let imageUrl: string | undefined;

    if (imageData.url) {
      imageUrl = imageData.url;
    } else if (imageData.b64_json) {
      // If base64, convert to data URL
      imageUrl = `data:image/png;base64,${imageData.b64_json}`;
    } else {
      console.error('Unexpected response format:', imageData);
      return NextResponse.json(
        { error: 'Invalid response format from OpenAI API' },
        { status: 500 }
      );
    }

    console.log('Image URL extracted:', imageUrl ? 'Success' : 'Failed');

    return NextResponse.json({
      success: true,
      editedImageUrl: imageUrl
    });

  } catch (error) {
    console.error('Error editing image:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    
    // Handle OpenAI specific errors
    if (error instanceof Error) {
      // Check for OpenAI API errors
      if ('status' in error) {
        const status = error.status as number;
        console.error('OpenAI API error status:', status);
        
        switch (status) {
          case 400:
            return NextResponse.json(
              { error: 'Invalid request to OpenAI API. Please check your image format, size, and mask. Make sure both images are the same dimensions and under 4MB.' },
              { status: 400 }
            );
          case 401:
            return NextResponse.json(
              { error: 'Invalid OpenAI API key. Please check your configuration.' },
              { status: 401 }
            );
          case 413:
            return NextResponse.json(
              { error: 'Files too large. Please reduce image size to under 4MB.' },
              { status: 413 }
            );
          case 429:
            return NextResponse.json(
              { error: 'Rate limit exceeded. Please try again later.' },
              { status: 429 }
            );
          case 500:
            return NextResponse.json(
              { error: 'OpenAI API server error. Please try again later.' },
              { status: 500 }
            );
        }
      }
      
      // Handle connection errors specifically
      if (error.message.includes('Connection error') || error.message.includes('ECONNRESET')) {
        return NextResponse.json(
          { error: 'Connection timeout. This usually happens with large files. Please try with a smaller image (under 2MB recommended).' },
          { status: 408 }
        );
      }
      
      // Handle other errors
      return NextResponse.json(
        { error: `Failed to edit image: ${error.message}` },
        { status: 500 }
      );
    }

    // Handle unknown errors
    return NextResponse.json(
      { error: 'An unexpected error occurred while editing the image' },
      { status: 500 }
    );
  }
}

// Optional: Add GET method for health check
export async function GET(): Promise<NextResponse<{ status: string; timestamp: string }>> {
  return NextResponse.json({
    status: 'Image editing API is running',
    timestamp: new Date().toISOString()
  });
}