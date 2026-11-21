export function planTryOn({ outfitId, destinationId, products }: {
    outfitId: any;
    destinationId: any;
    products: any;
}): Promise<{
    value: any;
    trace: {
        role: string;
        model: string;
        latencyMs: number;
    };
}>;
export function generateImage({ personImage, plan, destinationId, outfitId }: {
    personImage: any;
    plan: any;
    destinationId: any;
    outfitId: any;
}): Promise<{
    imageUrl: string;
    trace: {
        role: string;
        model: string;
        latencyMs: number;
    };
}>;
export function inspectResult({ personImage, resultImage, outfitId, destinationId }: {
    personImage: any;
    resultImage: any;
    outfitId: any;
    destinationId: any;
}): Promise<{
    value: any;
    trace: {
        role: string;
        model: string;
        latencyMs: number;
    };
}>;
