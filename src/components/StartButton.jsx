import React from 'react'
import { Button } from '@mantine/core';

// Prop-driven so one card can carry a real link while the rest stay placeholders.
// A card with no href renders a disabled button rather than a live one that does
// nothing, which is the difference between "not ready" and "broken".
const StartButton = ({ href, label = 'Start' }) => {
    const gradient = { from: 'green', to: 'lime', deg: 90 };

    if (!href) {
        return (
            <Button variant="gradient" gradient={gradient} fullWidth disabled>
                Coming soon
            </Button>
        )
    }

    return (
        <Button component="a" href={href} variant="gradient" gradient={gradient} fullWidth>
            {label}
        </Button>
    )
}
export default StartButton
