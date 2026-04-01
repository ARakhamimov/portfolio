import React from 'react'
import { Button } from '@mantine/core';

const StartButton = () => {
    return (
        <Button
      variant="gradient"
      gradient={{ from: 'green', to: 'lime', deg: 90 }}
      fullWidth
    >
      Start
    </Button>
    )
}
export default StartButton